import { useState } from 'react';
import { format } from 'date-fns';
import { useInvoices } from '../hooks/useInvoices';
import { useCsvExports, useGenerateCsv } from '../hooks/useExport';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/shared/StatusBadge';

export default function ExportManagement() {
  const { data: approvedPos = [] } = useInvoices(['approved', 'approved_ready_export'] as never);
  const { data: exports = [] } = useCsvExports();
  const generateCsv = useGenerateCsv();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ url: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(approvedPos.map((p) => p.id)));
  const clearAll = () => setSelected(new Set());

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

  const formatAmt = (v: number | null) =>
    v != null ? `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';

  const totalGross = approvedPos
    .filter((p) => selected.has(p.id))
    .reduce((sum, p) => sum + Number(p.gross_amount || 0), 0);

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
          Approved invoices become a validated CSV for accounting system import. Select the batch, review, export.
        </p>
      </div>

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
                  <th style={{ ...styles.th, width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === approvedPos.length && approvedPos.length > 0}
                      onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                    />
                  </th>
                  <th style={styles.th}>Supplier</th>
                  <th style={styles.th}>Ref</th>
                  <th style={styles.th}>Date</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Net</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>VAT</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Gross</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {approvedPos.map((po, idx) => {
                  const isSelected = selected.has(po.id);
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
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(po.id)}
                        />
                      </td>
                      <td style={{ ...styles.td, ...styles.tdSupplier }}>
                        {po.supplier_name ?? <em style={styles.unassigned}>— Unnamed</em>}
                      </td>
                      <td style={{ ...styles.td, ...styles.tdMono }}>
                        {po.transaction_reference ?? '—'}
                      </td>
                      <td style={{ ...styles.td, ...styles.tdMono }}>
                        {po.transaction_date ? format(new Date(po.transaction_date), 'dd MMM yyyy') : '—'}
                      </td>
                      <td style={{ ...styles.td, ...styles.tdMoney }}>{formatAmt(po.net_amount)}</td>
                      <td style={{ ...styles.td, ...styles.tdMoney }}>{formatAmt(po.vat_amount)}</td>
                      <td style={{ ...styles.td, ...styles.tdMoney, fontWeight: 600, color: 'var(--ink)' }}>
                        {formatAmt(po.gross_amount)}
                      </td>
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
            </div>
            <button
              className="btn"
              style={{
                ...styles.exportBtn,
                ...(generating ? { opacity: 0.7, cursor: 'wait' } : {}),
              }}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Generate CSV'}
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
              CSV generated with <strong style={styles.successStrong}>{result.count}</strong> records.
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
                  <th style={styles.th}>Generated By</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Download</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((exp, idx) => {
                  const generatedBy = (exp as Record<string, unknown>).generated_by as { display_name?: string } | null;
                  return (
                    <tr key={exp.id} style={{
                      ...styles.tr,
                      ...(idx % 2 === 1 ? styles.trAlt : {}),
                    }}>
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

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },
  masthead: {
    paddingBottom: 18,
    borderBottom: '1px solid var(--line)',
    marginBottom: 2,
  },
  kicker: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    marginBottom: 14,
  },
  kickerRule: { width: 28, height: 1, background: 'var(--accent)' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 4vw, 54px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.02,
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  titleEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  subtitle: {
    margin: '14px 0 0',
    maxWidth: 620,
    fontSize: 15,
    lineHeight: 1.6,
    color: 'var(--ink-muted)',
  },
  section: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '24px 26px 22px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 18,
    gap: 16,
    flexWrap: 'wrap',
  },
  sectionNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 26,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  sectionTitleEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  sectionActions: { display: 'flex', alignItems: 'center', gap: 12 },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'var(--accent-text)',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  linkCount: { color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 },
  linkDiv: { width: 1, height: 12, background: 'var(--line-strong)' },
  tableWrap: { overflow: 'auto', margin: '0 -26px', padding: '0 26px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    borderBottom: '1px solid var(--line-strong)',
    background: 'var(--paper-bright)',
    position: 'sticky',
    top: 0,
  },
  tr: {
    transition: 'background 0.12s var(--ease)',
    cursor: 'pointer',
  },
  trAlt: {
    background: 'var(--paper)',
  },
  trSelected: {
    background: 'var(--accent-soft)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  td: {
    padding: '12px 14px',
    fontSize: 13,
    borderBottom: '1px solid var(--line)',
    color: 'var(--ink-soft)',
    verticalAlign: 'middle',
  },
  tdSupplier: {
    color: 'var(--ink)',
    fontWeight: 500,
  },
  tdMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  tdMoney: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  unassigned: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    color: 'var(--ink-faint)',
  },
  exportBar: {
    marginTop: 20,
    padding: '16px 22px',
    background: 'var(--ink)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  exportBarMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  exportBarCount: { display: 'flex', alignItems: 'baseline', gap: 10 },
  exportBarNumber: {
    fontFamily: 'var(--font-display)',
    fontSize: 28,
    fontWeight: 400,
    color: 'var(--paper)',
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  exportBarLabel: {
    fontSize: 10.5,
    color: 'rgba(244, 239, 228, 0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontWeight: 500,
  },
  exportBarDivider: {
    width: 1,
    height: 32,
    background: 'rgba(244, 239, 228, 0.15)',
  },
  exportBarTotal: { display: 'flex', flexDirection: 'column', gap: 2 },
  exportBarAmount: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    color: 'var(--paper)',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  exportBtn: {
    padding: '12px 22px',
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#fff',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
  },
  exportBtnArrow: { fontSize: 14 },
  errorBanner: {
    marginTop: 16,
    background: 'var(--danger-soft)',
    border: '1px solid rgba(160, 49, 53, 0.25)',
    color: 'var(--danger)',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  successBanner: {
    marginTop: 16,
    background: 'var(--success-soft)',
    border: '1px solid rgba(58, 106, 63, 0.25)',
    color: 'var(--success)',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  bannerLabel: {
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  bannerLabelSuccess: {
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    flexShrink: 0,
    color: 'var(--success)',
  },
  successStrong: { fontFamily: 'var(--font-mono)', fontWeight: 600 },
  successLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    marginLeft: 'auto',
    color: 'var(--success)',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  downloadBtn: {
    padding: '6px 14px',
    background: 'transparent',
    border: '1px solid var(--line-strong)',
    color: 'var(--ink-soft)',
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  empty: {
    padding: '44px 20px',
    textAlign: 'center',
  },
  emptyMark: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 44,
    color: 'var(--ink-faint)',
    opacity: 0.45,
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 18,
    color: 'var(--ink-muted)',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: 'var(--ink-faint)',
  },
};
