import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useInvoices, useNominalLinesBulk } from '../hooks/useInvoices';
import { useCsvExports, useGenerateCsv } from '../hooks/useExport';
import { supabase } from '../lib/supabase';
import type { NominalLine } from '../lib/supabase';
import StatusBadge from '../components/shared/StatusBadge';

// ── Completeness check — mirrors the Sage 200 required fields ──────────────
interface PoRecord { id: string; account_number?: string | null; transaction_reference?: string | null; transaction_date?: string | null; gross_amount?: number | null; net_amount?: number | null; vat_amount?: number | null; description?: string | null; supplier_name?: string | null; [k: string]: unknown }

interface ReadinessResult {
  ready: boolean;
  missing: string[];
}

function checkReadiness(po: PoRecord, nominals: NominalLine[]): ReadinessResult {
  const missing: string[] = [];
  if (!po.account_number)        missing.push('Sage account code');
  if (!po.transaction_reference)  missing.push('Invoice number');
  if (!po.transaction_date)       missing.push('Invoice date');
  if (!po.gross_amount || Number(po.gross_amount) <= 0) missing.push('Gross amount');
  if (!po.description)            missing.push('Description / narrative');

  const n1 = nominals.find((l) => l.line_number === 1);
  if (!n1?.nominal_account_number) missing.push('Nominal account number');
  if (!n1?.nominal_cost_centre)    missing.push('Cost centre');

  return { ready: missing.length === 0, missing };
}

function truncate(str: string | null | undefined, max: number) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ExportManagement() {
  const { data: approvedPos = [] } = useInvoices(['approved', 'approved_ready_export'] as never);
  const { data: exports = [] }     = useCsvExports();
  const generateCsv                = useGenerateCsv();

  // Load all nominal lines for all approved POs in one query
  const poIds = useMemo(() => approvedPos.map((p) => p.id), [approvedPos]);
  const { data: allNominalLines = [] } = useNominalLinesBulk(poIds);

  // Build per-PO nominal map
  const nominalByPo = useMemo(() => {
    const map: Record<string, NominalLine[]> = {};
    for (const line of allNominalLines) {
      if (!map[line.purchase_order_id]) map[line.purchase_order_id] = [];
      map[line.purchase_order_id].push(line);
    }
    return map;
  }, [allNominalLines]);

  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [result, setResult]       = useState<{ url: string; count: number } | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll   = () => setSelected(new Set(approvedPos.map((p) => p.id)));
  const clearAll    = () => setSelected(new Set());
  const selectReady = () => {
    const readyIds = approvedPos
      .filter((p) => checkReadiness(p as unknown as PoRecord, nominalByPo[p.id] ?? []).ready)
      .map((p) => p.id);
    setSelected(new Set(readyIds));
  };

  const handleGenerate = async () => {
    if (selected.size === 0) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateCsv.mutateAsync(Array.from(selected));
      setResult({ url: res.download_url, count: res.record_count });
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const getExportDownloadUrl = async (storagePath: string) => {
    setError(null);
    try {
      const { data, error: urlError } = await supabase.storage
        .from('csv-exports')
        .createSignedUrl(storagePath, 3600);
      if (urlError) throw urlError;
      if (!data?.signedUrl) throw new Error('No signed URL returned');
      window.open(data.signedUrl, '_blank');
    } catch (e) {
      setError(`Could not generate download link: ${(e as Error).message}`);
    }
  };

  const formatAmt = (v: number | null | undefined) =>
    v != null ? `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';

  // Aggregates for selected rows
  const selectedPos = approvedPos.filter((p) => selected.has(p.id));
  const totalGross  = selectedPos.reduce((sum, p) => sum + Number(p.gross_amount || 0), 0);
  const incompleteSelected = selectedPos.filter(
    (p) => !checkReadiness(p as unknown as PoRecord, nominalByPo[p.id] ?? []).ready
  );
  const readyCount   = approvedPos.filter((p) => checkReadiness(p as unknown as PoRecord, nominalByPo[p.id] ?? []).ready).length;
  const missingCount = approvedPos.length - readyCount;

  return (
    <div style={styles.page}>
      {/* Masthead */}
      <div style={styles.masthead} className="animate-rise">
        <div style={styles.kicker}>
          <span style={styles.kickerRule} /> Export
        </div>
        <h1 style={styles.title}>
          Generate <em style={styles.titleEm}>the ledger</em>.
        </h1>
        <p style={styles.subtitle}>
          Approved invoices become a validated Sage 200 CSV. Each row shows the nominal account, cost centre, and description that will appear in Sage — verify before exporting.
        </p>
      </div>

      {/* Readiness summary strip */}
      {approvedPos.length > 0 && (
        <div style={styles.readinessSummary} className="animate-rise">
          <div style={styles.readinessItem}>
            <span style={{ ...styles.readinessDot, background: 'var(--success)' }} />
            <span style={styles.readinessCount}>{readyCount}</span>
            <span style={styles.readinessLabel}>ready to export</span>
          </div>
          {missingCount > 0 && (
            <div style={styles.readinessItem}>
              <span style={{ ...styles.readinessDot, background: 'var(--warning)' }} />
              <span style={{ ...styles.readinessCount, color: 'var(--warning)' }}>{missingCount}</span>
              <span style={styles.readinessLabel}>missing required fields</span>
            </div>
          )}
          <div style={styles.readinessDivider} />
          <button className="btn" style={styles.selectReadyBtn} onClick={selectReady}>
            Select ready only ({readyCount})
          </button>
        </div>
      )}

      {/* Approved table */}
      <section style={styles.section} className="animate-rise delay-1">
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionNumber}>01 · Awaiting export</div>
            <h2 style={styles.sectionTitle}>
              Approved <em style={styles.sectionTitleEm}>invoices</em>
            </h2>
          </div>
          <div style={styles.sectionActions}>
            <button className="btn" style={styles.linkBtn} onClick={selectAll}>
              Select all <span style={styles.linkCount}>({approvedPos.length})</span>
            </button>
            <span style={styles.linkDiv} />
            <button className="btn" style={styles.linkBtn} onClick={clearAll}>Clear</button>
          </div>
        </div>

        {approvedPos.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyMark}>§</div>
            <div style={styles.emptyTitle}>Nothing awaiting export.</div>
            <div style={styles.emptyText}>Approved invoices will appear here.</div>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === approvedPos.length && approvedPos.length > 0}
                      onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                    />
                  </th>
                  {/* Readiness indicator */}
                  <th style={{ ...styles.th, width: 28 }} title="Sage 200 readiness" />
                  <th style={styles.th}>Supplier</th>
                  <th style={styles.th}>Invoice ref</th>
                  <th style={styles.th}>Date</th>
                  {/* Sage 200 nominal fields */}
                  <th style={{ ...styles.th, ...styles.thSage }}>Sage account</th>
                  <th style={{ ...styles.th, ...styles.thSage }}>Nominal · CC</th>
                  <th style={{ ...styles.th, ...styles.thSage }}>Description</th>
                  {/* Amounts */}
                  <th style={{ ...styles.th, textAlign: 'right' }}>Net</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>VAT</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Gross</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {approvedPos.map((po, idx) => {
                  const isSelected = selected.has(po.id);
                  const poLines    = nominalByPo[po.id] ?? [];
                  const n1         = poLines.find((l) => l.line_number === 1);
                  const n2         = poLines.find((l) => l.line_number === 2);
                  const { ready, missing } = checkReadiness(po as unknown as PoRecord, poLines);
                  return (
                    <tr
                      key={po.id}
                      style={{
                        ...styles.tr,
                        ...(idx % 2 === 1 && !isSelected ? styles.trAlt : {}),
                        ...(isSelected ? styles.trSelected : {}),
                      }}
                      onClick={() => toggleSelect(po.id)}
                    >
                      {/* Checkbox */}
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(po.id)}
                        />
                      </td>

                      {/* Readiness dot */}
                      <td style={{ ...styles.td, padding: '12px 6px' }}>
                        {ready ? (
                          <span style={styles.dotReady} title="All required Sage fields present" />
                        ) : (
                          <span
                            style={styles.dotWarn}
                            title={`Missing: ${missing.join(', ')}`}
                          />
                        )}
                      </td>

                      {/* Supplier */}
                      <td style={{ ...styles.td, ...styles.tdSupplier }}>
                        <div>{po.supplier_name ?? <em style={styles.unassigned}>— Unnamed</em>}</div>
                        {po.account_number && (
                          <div style={styles.acctCode}>{po.account_number}</div>
                        )}
                      </td>

                      {/* Ref */}
                      <td style={{ ...styles.td, ...styles.tdMono }}>
                        {po.transaction_reference ?? <em style={styles.unassigned}>—</em>}
                      </td>

                      {/* Date */}
                      <td style={{ ...styles.td, ...styles.tdMono }}>
                        {po.transaction_date
                          ? format(new Date(po.transaction_date as string), 'dd MMM yyyy')
                          : '—'}
                      </td>

                      {/* Sage account (supplier) */}
                      <td style={{ ...styles.td, ...styles.tdSage }}>
                        {po.account_number ? (
                          <span style={styles.codeChip}>{po.account_number as string}</span>
                        ) : (
                          <span style={styles.missingCell}>⚠ missing</span>
                        )}
                      </td>

                      {/* Nominal account · Cost centre */}
                      <td style={{ ...styles.td, ...styles.tdSage }}>
                        {n1?.nominal_account_number ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={styles.codeChip}>{n1.nominal_account_number}</span>
                            {n1.nominal_cost_centre && (
                              <span style={styles.ccChip}>{n1.nominal_cost_centre}</span>
                            )}
                            {n2?.nominal_account_number && (
                              <span style={styles.line2Hint}>+line 2: {n2.nominal_account_number}</span>
                            )}
                          </div>
                        ) : (
                          <span style={styles.missingCell}>⚠ missing</span>
                        )}
                      </td>

                      {/* Description / narrative */}
                      <td style={{ ...styles.td, ...styles.tdSage, fontSize: 12, color: 'var(--ink-muted)' }}>
                        {po.description ? (
                          <span title={po.description as string}>{truncate(po.description as string, 40)}</span>
                        ) : (
                          <span style={styles.missingCell}>⚠ missing</span>
                        )}
                      </td>

                      {/* Amounts */}
                      <td style={{ ...styles.td, ...styles.tdMoney }}>{formatAmt(po.net_amount as number)}</td>
                      <td style={{ ...styles.td, ...styles.tdMoney }}>{formatAmt(po.vat_amount as number)}</td>
                      <td style={{ ...styles.td, ...styles.tdMoney, fontWeight: 600, color: 'var(--ink)' }}>
                        {formatAmt(po.gross_amount as number)}
                      </td>

                      {/* Status */}
                      <td style={styles.td}>
                        <StatusBadge status={po.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Export action bar */}
        {selected.size > 0 && (
          <div style={styles.exportBar} className="animate-rise">
            <div style={styles.exportBarMeta}>
              <div style={styles.exportBarCount}>
                <span style={styles.exportBarNumber}>{selected.size}</span>
                <span style={styles.exportBarLabel}>
                  invoice{selected.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div style={styles.exportBarDivider} />
              <div style={styles.exportBarTotal}>
                <span style={styles.exportBarLabel}>Total gross</span>
                <span style={styles.exportBarAmount}>
                  £{totalGross.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {incompleteSelected.length > 0 && (
                <>
                  <div style={styles.exportBarDivider} />
                  <div style={styles.exportBarWarning}>
                    <span style={styles.exportBarWarnIcon}>⚠</span>
                    <span style={styles.exportBarWarnText}>
                      {incompleteSelected.length} invoice{incompleteSelected.length !== 1 ? 's' : ''} missing required fields
                      — will fail validation
                    </span>
                  </div>
                </>
              )}
            </div>
            <button
              className="btn"
              style={{
                ...styles.exportBtn,
                ...(generating ? { opacity: 0.7, cursor: 'wait' } : {}),
                ...(incompleteSelected.length > 0 ? styles.exportBtnWarn : {}),
              }}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Export to Sage 200 CSV'}
              <span style={styles.exportBtnArrow}>→</span>
            </button>
          </div>
        )}

        {error && (
          <div style={styles.errorBanner}>
            <span style={styles.bannerLabel}>Error</span>
            {error}
          </div>
        )}

        {result && (
          <div style={styles.successBanner}>
            <span style={styles.bannerLabelSuccess}>Exported</span>
            <span>
              Sage 200 CSV generated — <strong style={styles.successStrong}>{result.count}</strong> record{result.count !== 1 ? 's' : ''}.
            </span>
            <button
              type="button"
              onClick={() => window.open(result.url, '_blank')}
              style={styles.successLink}
            >
              Download CSV →
            </button>
          </div>
        )}
      </section>

      {/* Export history */}
      <section style={styles.section} className="animate-rise delay-2">
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionNumber}>02 · History</div>
            <h2 style={styles.sectionTitle}>
              Past <em style={styles.sectionTitleEm}>exports</em>
            </h2>
          </div>
        </div>

        {exports.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyMark}>§</div>
            <div style={styles.emptyText}>No exports yet.</div>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Generated</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Records</th>
                  <th style={styles.th}>Generated by</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Download</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((exp, idx) => {
                  const generatedBy = (exp as Record<string, unknown>).generated_by as { display_name?: string } | null;
                  return (
                    <tr key={exp.id} style={{ ...styles.tr, ...(idx % 2 === 1 ? styles.trAlt : {}) }}>
                      <td style={{ ...styles.td, ...styles.tdMono }}>
                        {format(new Date(exp.generated_at), 'dd MMM yyyy · HH:mm')}
                      </td>
                      <td style={{ ...styles.td, ...styles.tdMoney, color: 'var(--ink)', fontWeight: 600 }}>
                        {exp.record_count}
                      </td>
                      <td style={styles.td}>
                        {generatedBy?.display_name ?? <em style={styles.unassigned}>—</em>}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        <button
                          className="btn"
                          style={styles.downloadBtn}
                          onClick={() => getExportDownloadUrl(exp.storage_path)}
                        >
                          Download →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },

  masthead: { paddingBottom: 18, borderBottom: '1px solid var(--line)', marginBottom: 2 },
  kicker: {
    display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, fontWeight: 600,
    color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.22em', marginBottom: 14,
  },
  kickerRule: { width: 28, height: 1, background: 'var(--accent)' },
  title: {
    margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 4vw, 54px)',
    fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.025em', lineHeight: 1.02,
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  titleEm: { fontStyle: 'italic', color: 'var(--accent)', fontVariationSettings: "'opsz' 144, 'SOFT' 100" },
  subtitle: { margin: '14px 0 0', maxWidth: 640, fontSize: 15, lineHeight: 1.6, color: 'var(--ink-muted)' },

  // Readiness summary strip
  readinessSummary: {
    display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    padding: '12px 18px', background: 'var(--paper-bright)', border: '1px solid var(--line)',
    borderRadius: 10,
  },
  readinessItem: { display: 'flex', alignItems: 'center', gap: 8 },
  readinessDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  readinessCount: {
    fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
    color: 'var(--ink)', fontVariantNumeric: 'tabular-nums',
  },
  readinessLabel: { fontSize: 12, color: 'var(--ink-muted)' },
  readinessDivider: { width: 1, height: 20, background: 'var(--line-strong)', marginLeft: 4 },
  selectReadyBtn: {
    background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600,
    color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer',
  },

  section: {
    background: 'var(--paper-bright)', border: '1px solid var(--line)', borderRadius: 12,
    padding: '24px 26px 22px',
  },
  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    marginBottom: 18, gap: 16, flexWrap: 'wrap',
  },
  sectionNumber: {
    fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--accent)', fontWeight: 500,
    letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6,
  },
  sectionTitle: {
    margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400,
    color: 'var(--ink)', letterSpacing: '-0.02em', lineHeight: 1.1,
  },
  sectionTitleEm: { fontStyle: 'italic', color: 'var(--accent)', fontVariationSettings: "'opsz' 144, 'SOFT' 100" },
  sectionActions: { display: 'flex', alignItems: 'center', gap: 12 },
  linkBtn: {
    background: 'none', border: 'none', padding: 0,
    color: 'var(--accent-text)', fontSize: 12, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.14em',
  },
  linkCount: { color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 },
  linkDiv: { width: 1, height: 12, background: 'var(--line-strong)' },

  tableWrap: { overflow: 'auto', margin: '0 -26px', padding: '0 26px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
    color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.14em',
    borderBottom: '1px solid var(--line-strong)', background: 'var(--paper-bright)',
    position: 'sticky', top: 0, whiteSpace: 'nowrap',
  },
  // Sage-specific column headers get a subtle accent tint
  thSage: {
    background: 'rgba(0,180,216,0.04)',
    color: 'var(--accent)',
    borderBottom: '1px solid rgba(0,180,216,0.18)',
  },

  tr: { transition: 'background 0.12s var(--ease)', cursor: 'pointer' },
  trAlt: { background: 'var(--paper)' },
  trSelected: { background: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)' },

  td: { padding: '11px 12px', fontSize: 13, borderBottom: '1px solid var(--line)', color: 'var(--ink-soft)', verticalAlign: 'middle' },
  tdSage: { background: 'rgba(0,180,216,0.025)' },
  tdSupplier: { color: 'var(--ink)', fontWeight: 500 },
  tdMono: { fontFamily: 'var(--font-mono)', fontSize: 12 },
  tdMoney: { fontFamily: 'var(--font-mono)', fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },

  acctCode: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 },
  codeChip: {
    display: 'inline-block', padding: '2px 7px', borderRadius: 5,
    background: 'rgba(0,180,216,0.08)', color: 'var(--accent)',
    border: '1px solid rgba(0,180,216,0.18)', fontSize: 11, fontWeight: 700,
    fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
  },
  ccChip: {
    display: 'inline-block', padding: '2px 7px', borderRadius: 5,
    background: 'rgba(6,214,160,0.08)', color: 'var(--accent-2)',
    border: '1px solid rgba(6,214,160,0.2)', fontSize: 10.5, fontWeight: 600,
    fontFamily: 'var(--font-mono)',
  },
  line2Hint: { fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' },
  missingCell: { fontSize: 11, color: 'var(--warning)', fontWeight: 600, letterSpacing: '0.04em' },
  unassigned: { fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--ink-faint)' },

  // Readiness dots in table
  dotReady: {
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: 'var(--success)', boxShadow: '0 0 0 2px rgba(16,185,129,0.15)',
  },
  dotWarn: {
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: 'var(--warning)', boxShadow: '0 0 0 2px rgba(214,158,46,0.2)',
  },

  // Export action bar
  exportBar: {
    marginTop: 20, padding: '16px 22px', background: 'var(--ink)', borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 20, flexWrap: 'wrap',
  },
  exportBarMeta: { display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  exportBarCount: { display: 'flex', alignItems: 'baseline', gap: 10 },
  exportBarNumber: {
    fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400,
    color: 'var(--paper)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
  },
  exportBarLabel: { fontSize: 10.5, color: 'rgba(244, 239, 228, 0.55)', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 500 },
  exportBarDivider: { width: 1, height: 32, background: 'rgba(244, 239, 228, 0.15)' },
  exportBarTotal: { display: 'flex', flexDirection: 'column', gap: 2 },
  exportBarAmount: { fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--paper)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' },
  exportBarWarning: { display: 'flex', alignItems: 'center', gap: 8 },
  exportBarWarnIcon: { fontSize: 14, color: 'var(--warning)' },
  exportBarWarnText: { fontSize: 11.5, color: 'var(--warning)', fontWeight: 500, maxWidth: 240, lineHeight: 1.3 },

  exportBtn: {
    padding: '12px 22px', background: 'var(--accent)', border: '1px solid var(--accent)',
    color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap',
  },
  exportBtnWarn: {
    background: 'var(--warning)', borderColor: 'var(--warning)', color: '#fff',
  },
  exportBtnArrow: { fontSize: 14 },

  errorBanner: {
    marginTop: 16, background: 'var(--danger-soft)', border: '1px solid rgba(160, 49, 53, 0.25)',
    color: 'var(--danger)', padding: '10px 16px', borderRadius: 8, fontSize: 13,
    display: 'flex', alignItems: 'baseline', gap: 12,
  },
  successBanner: {
    marginTop: 16, background: 'var(--success-soft)', border: '1px solid rgba(58, 106, 63, 0.25)',
    color: 'var(--success)', padding: '12px 16px', borderRadius: 8, fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
  },
  bannerLabel: { fontWeight: 700, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', flexShrink: 0 },
  bannerLabelSuccess: { fontWeight: 700, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', flexShrink: 0, color: 'var(--success)' },
  successStrong: { fontFamily: 'var(--font-mono)', fontWeight: 600 },
  successLink: {
    background: 'none', border: 'none', padding: 0, marginLeft: 'auto',
    color: 'var(--success)', fontWeight: 600, cursor: 'pointer', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: '0.12em',
  },
  downloadBtn: {
    padding: '6px 14px', background: 'transparent', border: '1px solid var(--line-strong)',
    color: 'var(--ink-soft)', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
    textTransform: 'uppercase', letterSpacing: '0.12em',
  },

  empty: { padding: '44px 20px', textAlign: 'center' },
  emptyMark: { fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 44, color: 'var(--ink-faint)', opacity: 0.45, marginBottom: 8 },
  emptyTitle: { fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, color: 'var(--ink-muted)', marginBottom: 4 },
  emptyText: { fontSize: 13, color: 'var(--ink-faint)' },
};
