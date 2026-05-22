import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useInvoice, useOcrExtraction } from '../hooks/useInvoices';
import { useAuditLog } from '../hooks/useApprovals';
import AuditTimeline from '../components/shared/AuditTimeline';
import StatusBadge from '../components/shared/StatusBadge';
import OcrComparisonPanel from '../components/invoice/OcrComparisonPanel';
import type { PurchaseOrder, AuditLogEntry } from '../lib/supabase';

function escCsv(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadAuditCsv(entries: AuditLogEntry[], supplierName: string, ref: string) {
  const header = ['Timestamp', 'Action', 'Actor', 'Actor Email', 'New Values', 'Old Values', 'Metadata'];
  const rows = entries.map(e => [
    format(new Date(e.created_at), 'dd/MM/yyyy HH:mm:ss'),
    e.action,
    e.actor_display ?? '',
    e.actor_email ?? '',
    escCsv(e.new_values),
    escCsv(e.old_values),
    escCsv(e.metadata),
  ]);
  const csv = [header, ...rows].map(r => r.map(escCsv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (supplierName || 'invoice').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  a.href = url;
  a.download = `audit_${safeName}_${ref || 'unknown'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditTrailViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const { data: po, isLoading } = useInvoice(id!);
  const { data: auditLog = [] } = useAuditLog(id!);
  const { data: ocr } = useOcrExtraction(id!);

  if (isLoading) return <div style={styles.loading}>Loading audit trail…</div>;
  if (!po) return <div style={styles.error}>Invoice not found.</div>;

  const poData = po as PurchaseOrder;

  const formatMoney = (v: number | null) =>
    v != null ? `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div style={styles.page}>
      {/* Masthead */}
      <div style={styles.masthead} className="animate-rise">
        <button style={styles.back} onClick={() => navigate(`/invoices/${id}`)}>
          <span style={styles.backArrow}>←</span> Back to invoice
        </button>
        <div style={styles.kicker}>
          <span style={styles.kickerRule} /> Audit Trail · Immutable
        </div>
        <div style={styles.titleRow}>
          <h1 style={styles.title}>
            The <em style={styles.titleEm}>full record</em>.
          </h1>
          <StatusBadge status={poData.status} />
        </div>
        <p style={styles.subtitle}>
          Every event on this invoice, in order. Nothing can be deleted or edited.
        </p>
      </div>

      {/* Summary strip */}
      <div style={styles.summary} className="animate-rise delay-1">
        <SummaryItem label="Supplier" value={poData.supplier_name ?? '—'} />
        <div style={styles.summaryRule} />
        <SummaryItem
          label="Invoice Ref"
          value={poData.transaction_reference ?? '—'}
          mono
        />
        <div style={styles.summaryRule} />
        <SummaryItem
          label="Invoice Date"
          value={poData.transaction_date ? format(new Date(poData.transaction_date), 'dd MMM yyyy') : '—'}
          mono
        />
        <div style={styles.summaryRule} />
        <SummaryItem
          label="Gross Amount"
          value={formatMoney(poData.gross_amount)}
          highlight
        />
        <div style={styles.summaryRule} />
        <SummaryItem
          label="Created"
          value={format(new Date(poData.created_at), 'dd MMM · HH:mm')}
          mono
          small
        />
        <div style={styles.summaryRule} />
        <SummaryItem
          label="Last Updated"
          value={format(new Date(poData.updated_at), 'dd MMM · HH:mm')}
          mono
          small
        />
      </div>

      <div style={styles.layout}>
        {/* Timeline */}
        <div style={styles.timelinePanel} className="animate-rise delay-2">
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <span style={styles.panelNumber}>§</span>
              <h2 style={styles.panelTitle}>
                Event <em style={styles.panelTitleEm}>history</em>
              </h2>
              <span style={styles.panelCount}>
                {auditLog.length} {auditLog.length === 1 ? 'event' : 'events'}
              </span>
              <button
                style={styles.exportBtn}
                disabled={exporting || auditLog.length === 0}
                onClick={() => {
                  setExporting(true);
                  try {
                    downloadAuditCsv(auditLog, poData.supplier_name ?? '', poData.transaction_reference ?? id ?? '');
                  } finally {
                    setExporting(false);
                  }
                }}
                title="Download audit trail as CSV"
              >
                {exporting ? '…' : '↓ Export CSV'}
              </button>
            </div>
            <AuditTimeline entries={auditLog} />
          </div>
        </div>

        {/* Details */}
        <div style={styles.detailPanel} className="animate-rise delay-3">
          {ocr && (
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.panelNumber}>01</span>
                <h2 style={styles.panelTitle}>AI extraction</h2>
              </div>
              <OcrComparisonPanel ocr={ocr} po={poData} />
              <div style={styles.ocrMeta}>
                <span style={styles.ocrMetaKey}>Model</span>
                <span style={styles.ocrMetaVal}>{ocr.gemini_model}</span>
                <span style={styles.ocrMetaSep}>·</span>
                <span style={styles.ocrMetaKey}>Time</span>
                <span style={styles.ocrMetaVal}>{ocr.processing_ms}ms</span>
                <span style={styles.ocrMetaSep}>·</span>
                <span style={styles.ocrMetaKey}>Extracted</span>
                <span style={styles.ocrMetaVal}>
                  {format(new Date(ocr.created_at), 'dd MMM yyyy HH:mm:ss')}
                </span>
              </div>
            </div>
          )}

          {(poData.approved_at || poData.rejected_reason) && (
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.panelNumber}>02</span>
                <h2 style={styles.panelTitle}>
                  Approval <em style={styles.panelTitleEm}>outcome</em>
                </h2>
              </div>
              <dl style={styles.dl}>
                {poData.approved_at && (
                  <>
                    <dt style={styles.dt}>Approved at</dt>
                    <dd style={styles.dd}>
                      {format(new Date(poData.approved_at), 'dd MMM yyyy · HH:mm')}
                    </dd>
                  </>
                )}
                {poData.approver_comments && (
                  <>
                    <dt style={styles.dt}>Approver comments</dt>
                    <dd style={{ ...styles.dd, ...styles.ddQuote }}>
                      {poData.approver_comments}
                    </dd>
                  </>
                )}
                {poData.rejected_reason && (
                  <>
                    <dt style={styles.dt}>Rejection reason</dt>
                    <dd style={{ ...styles.dd, color: 'var(--danger)', ...styles.ddQuote }}>
                      {poData.rejected_reason}
                    </dd>
                  </>
                )}
                {poData.forwarded_reason && (
                  <>
                    <dt style={styles.dt}>Forwarded reason</dt>
                    <dd style={{ ...styles.dd, ...styles.ddQuote }}>{poData.forwarded_reason}</dd>
                  </>
                )}
                {poData.exported_at && (
                  <>
                    <dt style={styles.dt}>Exported at</dt>
                    <dd style={styles.dd}>
                      {format(new Date(poData.exported_at), 'dd MMM yyyy · HH:mm')}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryItem({
  label, value, mono, small, highlight,
}: {
  label: string; value: string; mono?: boolean; small?: boolean; highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{
        fontSize: 10,
        color: 'var(--ink-faint)',
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: small ? 12 : highlight ? 18 : 14,
        fontWeight: highlight ? 500 : 500,
        color: highlight ? 'var(--accent)' : 'var(--ink)',
        fontFamily: highlight
          ? 'var(--font-display)'
          : mono
          ? 'var(--font-mono)'
          : 'inherit',
        letterSpacing: highlight ? '-0.015em' : '0',
        fontVariantNumeric: mono || highlight ? 'tabular-nums' : undefined,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },
  masthead: {
    paddingBottom: 18,
    borderBottom: '1px solid var(--line)',
  },
  back: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--ink-muted)',
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  backArrow: { color: 'var(--accent)' },
  kicker: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    marginBottom: 12,
  },
  kickerRule: { width: 28, height: 1, background: 'var(--accent)' },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 4vw, 52px)',
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
    fontSize: 14.5,
    lineHeight: 1.6,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  summary: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 20,
    padding: '16px 22px',
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    flexWrap: 'wrap',
  },
  summaryRule: {
    width: 1,
    background: 'var(--line)',
    alignSelf: 'stretch',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
    gap: 18,
  },
  timelinePanel: { minWidth: 0 },
  detailPanel: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 },
  panel: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '22px 24px',
    marginBottom: 14,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  panelNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.12em',
  },
  panelTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
    flex: 1,
  },
  panelTitleEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  panelCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontWeight: 500,
  },
  exportBtn: {
    padding: '5px 12px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    border: '1px solid var(--line-strong)',
    background: 'var(--paper)',
    color: 'var(--ink-soft)',
    borderRadius: 6,
    cursor: 'pointer',
    marginLeft: 'auto',
    textTransform: 'uppercase',
    transition: 'all 0.12s',
  },
  ocrMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: '10px 14px',
    background: 'var(--paper)',
    border: '1px dashed var(--line-strong)',
    borderRadius: 7,
    fontSize: 11,
  },
  ocrMetaKey: {
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontWeight: 600,
  },
  ocrMetaVal: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--ink-soft)',
    fontSize: 11.5,
  },
  ocrMetaSep: { color: 'var(--ink-faint)' },
  dl: {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    gap: '12px 20px',
  },
  dt: {
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    paddingTop: 2,
  },
  dd: {
    margin: 0,
    fontSize: 13.5,
    color: 'var(--ink)',
    lineHeight: 1.5,
    fontFamily: 'var(--font-mono)',
  },
  ddQuote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 14,
    color: 'var(--ink-soft)',
    paddingLeft: 14,
    borderLeft: '2px solid var(--line-strong)',
  },
  loading: {
    padding: 80,
    textAlign: 'center',
    color: 'var(--ink-muted)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 16,
  },
  error: {
    padding: 16,
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    borderRadius: 8,
    border: '1px solid rgba(160, 49, 53, 0.25)',
  },
};
