import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useInvoice, useNominalLines, useVatLines, useOcrExtraction } from '../hooks/useInvoices';
import { useSubmitApprovalDecision, useApprovers } from '../hooks/useApprovals';
import OcrComparisonPanel from '../components/invoice/OcrComparisonPanel';
import StatusBadge from '../components/shared/StatusBadge';
import { getInvoiceSignedUrl } from '../lib/auth';
import type { PurchaseOrder, NominalLine } from '../lib/supabase';

export default function ApproverView() {
  const { id } = useParams<{ id: string }>();

  const { data: po, isLoading } = useInvoice(id!);
  const { data: nominalLines = [] } = useNominalLines(id!);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: _vatLines = [] } = useVatLines(id!);
  const { data: ocr } = useOcrExtraction(id!);
  const { data: approvers = [] } = useApprovers();
  const submitDecision = useSubmitApprovalDecision();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [action, setAction] = useState<'approve' | 'reject' | 'forward' | null>(null);
  const [comment, setComment] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (po) {
      const fileData = (po as Record<string, unknown>).invoice_file as { storage_path?: string } | null;
      console.debug('[ApproverView] invoice_file join:', fileData);
      if (fileData?.storage_path) {
        console.debug('[ApproverView] fetching signed URL for:', fileData.storage_path);
        getInvoiceSignedUrl(fileData.storage_path).then((url) => {
          console.debug('[ApproverView] signed URL result:', url ? 'OK' : 'null');
          setPdfUrl(url);
        });
      } else {
        console.warn('[ApproverView] no storage_path on invoice_file — fileData:', fileData);
      }
    }
  }, [po]);

  if (isLoading) return <div style={styles.loading}>Loading invoice…</div>;
  if (!po) return <div style={styles.error}>Invoice not found.</div>;

  const poData = po as PurchaseOrder & { invoice_file?: unknown; approver?: unknown };

  const handleSubmit = async () => {
    if (!action) return;
    if (action === 'reject' && !comment.trim()) {
      setError('A reason is required when rejecting.');
      return;
    }
    if (action === 'forward' && !forwardTo) {
      setError('Please select an approver to forward to.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitDecision.mutateAsync({
        purchase_order_id: id!,
        action,
        comment: comment.trim() || undefined,
        forward_to_approver_id: action === 'forward' ? forwardTo : undefined,
      });
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    const word = action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Forwarded';
    const body =
      action === 'approve'
        ? 'Finance has been notified of your approval.'
        : action === 'reject'
        ? 'Finance has been notified with your reason.'
        : 'The invoice has been forwarded to the selected approver.';

    return (
      <div style={styles.successPage}>
        <div style={styles.successCard} className="animate-rise">
          <div style={styles.successKicker}>§ Complete</div>
          <h2 style={styles.successTitle}>Invoice <em style={styles.successEm}>{word.toLowerCase()}</em>.</h2>
          <p style={styles.successText}>{body}</p>
          <div style={styles.successRule} />
          <div style={styles.successFoot}>You may close this window.</div>
        </div>
      </div>
    );
  }

  const formatAmount = (v: number | null) =>
    v != null ? `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div style={styles.page}>
      {/* Masthead */}
      <div style={styles.masthead} className="animate-rise">
        <div style={styles.kicker}>
          <span style={styles.kickerRule} /> Approval Request
        </div>
        <div style={styles.titleRow}>
          <h1 style={styles.title}>
            Your <em style={styles.titleEm}>decision</em>, please.
          </h1>
          <StatusBadge status={poData.status} />
        </div>
        <p style={styles.subtitle}>
          Review the invoice details below. You are confirming spend approval — not data accuracy.
        </p>
      </div>

      <div style={styles.notice} className="animate-rise delay-1">
        <span style={styles.noticeLabel}>§ Read-only</span>
        <span>Finance has validated all details. This page shows them for confirmation.</span>
      </div>

      <div style={styles.layout} className="split-layout">
        {/* Left: PDF */}
        <div style={styles.pdfPanel} className="animate-rise delay-1">
          <div style={styles.pdfLabel}>§ Document</div>
          <div style={styles.pdfFrameWrap}>
            {pdfUrl ? (
              <iframe src={pdfUrl} style={styles.pdfFrame} title="Invoice" />
            ) : (
              <div style={styles.noPdf}>
                <div style={styles.noPdfMark}>§</div>
                <div>No document available</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Summary + Actions */}
        <div style={styles.rightPanel} className="animate-rise delay-2">
          {/* Hero summary card */}
          <section style={styles.hero}>
            <div style={styles.heroTop}>
              <div style={styles.heroKicker}>§ Invoice Summary</div>
              <div style={styles.heroSupplier}>{poData.supplier_name ?? '—'}</div>
              <div style={styles.heroRef}>
                {poData.transaction_reference ?? '—'}
                {poData.transaction_date && (
                  <>
                    <span style={styles.heroDot}>·</span>
                    {format(new Date(poData.transaction_date), 'dd MMM yyyy')}
                  </>
                )}
              </div>
            </div>

            <div style={styles.heroGross}>
              <div style={styles.heroGrossLabel}>Gross Amount</div>
              <div style={styles.heroGrossVal}>{formatAmount(poData.gross_amount)}</div>
            </div>

            <div style={styles.heroSplit}>
              <div style={styles.heroSplitItem}>
                <span style={styles.heroSplitLabel}>Net</span>
                <span style={styles.heroSplitVal}>{formatAmount(poData.net_amount)}</span>
              </div>
              <div style={styles.heroSplitRule} />
              <div style={styles.heroSplitItem}>
                <span style={styles.heroSplitLabel}>VAT</span>
                <span style={styles.heroSplitVal}>{formatAmount(poData.vat_amount)}</span>
              </div>
              <div style={styles.heroSplitRule} />
              <div style={styles.heroSplitItem}>
                <span style={styles.heroSplitLabel}>Account</span>
                <span style={styles.heroSplitVal}>{poData.account_number ?? '—'}</span>
              </div>
            </div>

            {poData.description && (
              <div style={styles.heroDesc}>
                <div style={styles.heroDescLabel}>Description</div>
                <div style={styles.heroDescText}>{poData.description}</div>
              </div>
            )}
          </section>

          {/* Finance Notes */}
          {poData.finance_notes && (
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionNumber}>01</span>
                <h3 style={styles.sectionTitle}>Notes from finance</h3>
                <span style={styles.sectionRule} />
              </div>
              <blockquote style={styles.notes}>
                {poData.finance_notes}
              </blockquote>
            </section>
          )}

          {/* Nominal lines */}
          {nominalLines.length > 0 && (
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionNumber}>02</span>
                <h3 style={styles.sectionTitle}>Nominal analysis</h3>
                <span style={styles.sectionRule} />
              </div>
              {(nominalLines as NominalLine[]).map((line) => (
                <div key={line.id} style={styles.nominalRow}>
                  <span style={styles.nominalNum}>{String(line.line_number).padStart(2, '0')}</span>
                  <span style={styles.nominalCol}>{line.nominal_account_number ?? '—'}</span>
                  <span style={styles.nominalCol}>{line.nominal_cost_centre ?? '—'}</span>
                  <span style={styles.nominalCol}>{line.nominal_department ?? '—'}</span>
                  <span style={styles.nominalAmt}>
                    {line.transaction_value != null ? formatAmount(line.transaction_value) : '—'}
                  </span>
                </div>
              ))}
            </section>
          )}

          <OcrComparisonPanel ocr={ocr ?? null} po={poData} />

          {/* Decision */}
          {poData.status === 'pending_approval' && (
            <section style={styles.decisionSection}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionNumber}>§</span>
                <h3 style={styles.sectionTitleLg}>Your decision</h3>
                <span style={styles.sectionRule} />
              </div>
              <p style={styles.decisionNote}>
                By approving, you confirm this spend is authorised. You are not verifying invoice accuracy.
              </p>

              <div style={styles.actionButtons}>
                <DecisionBtn
                  active={action === 'approve'}
                  onClick={() => setAction('approve')}
                  tint="success"
                  label="Approve"
                  subtitle="Authorise the spend"
                />
                <DecisionBtn
                  active={action === 'reject'}
                  onClick={() => setAction('reject')}
                  tint="danger"
                  label="Reject"
                  subtitle="Return with reason"
                />
                <DecisionBtn
                  active={action === 'forward'}
                  onClick={() => setAction('forward')}
                  tint="warning"
                  label="Forward"
                  subtitle="Send to another approver"
                />
              </div>

              {(action === 'reject' || action === 'forward') && (
                <div style={styles.reasonField}>
                  <label style={styles.label}>
                    {action === 'reject' ? 'Reason for rejection (required)' : 'Reason for forwarding'}
                  </label>
                  <textarea
                    style={styles.textarea}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={action === 'reject' ? 'Why is this being rejected…' : 'Optional context…'}
                  />
                </div>
              )}

              {action === 'forward' && (
                <div style={styles.reasonField}>
                  <label style={styles.label}>Forward to approver</label>
                  <select
                    style={styles.select}
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                  >
                    <option value="">Select approver…</option>
                    {approvers.map((a) => (
                      <option key={a.id} value={a.id}>{a.display_name} ({a.email})</option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div style={styles.errorBanner}>
                  <span style={styles.bannerLabel}>Error</span>
                  {error}
                </div>
              )}

              {action && (
                <button
                  className="btn"
                  style={styles.submitBtn}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : `Confirm ${action}`}
                  <span style={styles.submitArrow}>→</span>
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function DecisionBtn({
  active, onClick, tint, label, subtitle,
}: {
  active: boolean;
  onClick: () => void;
  tint: 'success' | 'danger' | 'warning';
  label: string;
  subtitle: string;
}) {
  const accentVar = tint === 'success' ? 'var(--success)' : tint === 'danger' ? 'var(--danger)' : 'var(--warning)';
  const softVar = tint === 'success' ? 'var(--success-soft)' : tint === 'danger' ? 'var(--danger-soft)' : 'var(--warning-soft)';
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '18px 16px',
        background: active ? softVar : 'var(--paper)',
        border: `1px solid ${active ? accentVar : 'var(--line-strong)'}`,
        borderRadius: 10,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'all 0.15s var(--ease)',
        boxShadow: active ? `inset 0 0 0 1px ${accentVar}` : 'none',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        fontWeight: 500,
        color: active ? accentVar : 'var(--ink)',
        letterSpacing: '-0.01em',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11,
        color: 'var(--ink-faint)',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        fontWeight: 500,
      }}>
        {subtitle}
      </span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  masthead: {
    paddingBottom: 14,
    borderBottom: '1px solid var(--line)',
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
    fontSize: 'clamp(32px, 3.4vw, 44px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.05,
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  titleEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  subtitle: {
    margin: '14px 0 0',
    maxWidth: 640,
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--ink-muted)',
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '10px 16px',
    background: 'var(--warning-soft)',
    border: '1px solid rgba(154, 107, 30, 0.22)',
    borderRadius: 8,
    fontSize: 12.5,
    color: 'var(--warning)',
  },
  noticeLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 0.82fr) minmax(0, 1fr)',
    gap: 18,
  },
  pdfPanel: {
    display: 'flex',
    flexDirection: 'column',
    position: 'sticky',
    top: 16,
    alignSelf: 'flex-start',
    maxHeight: 'calc(100vh - 120px)',
  },
  pdfLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingLeft: 4,
  },
  pdfFrameWrap: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    overflow: 'hidden',
    flex: 1,
    minHeight: 640,
  },
  pdfFrame: { width: '100%', height: '100%', minHeight: 640, border: 'none' },
  noPdf: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 400,
    color: 'var(--ink-muted)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 14,
  },
  noPdfMark: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 48,
    color: 'var(--ink-faint)',
    opacity: 0.45,
  },
  rightPanel: { minWidth: 0 },
  hero: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '28px 30px 24px',
    marginBottom: 14,
    boxShadow: '0 1px 0 rgba(20, 24, 31, 0.02)',
  },
  heroTop: { marginBottom: 22 },
  heroKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  heroSupplier: {
    fontFamily: 'var(--font-display)',
    fontSize: 28,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  heroRef: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--ink-muted)',
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  heroDot: { color: 'var(--ink-faint)' },
  heroGross: {
    padding: '18px 22px',
    background: 'var(--accent-soft)',
    border: '1px solid rgba(181, 78, 28, 0.22)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heroGrossLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
  },
  heroGrossVal: {
    fontFamily: 'var(--font-display)',
    fontSize: 36,
    fontWeight: 500,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  heroSplit: {
    display: 'flex',
    alignItems: 'stretch',
    padding: '4px 0',
  },
  heroSplitItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  heroSplitRule: { width: 1, background: 'var(--line)', margin: '0 16px' },
  heroSplitLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
  },
  heroSplitVal: {
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    color: 'var(--ink)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  heroDesc: {
    marginTop: 18,
    paddingTop: 18,
    borderTop: '1px dashed var(--line-strong)',
  },
  heroDescLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    marginBottom: 6,
  },
  heroDescText: {
    fontSize: 14,
    color: 'var(--ink)',
    lineHeight: 1.55,
  },
  section: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '20px 22px',
    marginBottom: 14,
  },
  decisionSection: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--ink-soft)',
    borderRadius: 12,
    padding: '26px 26px 24px',
    marginBottom: 14,
    boxShadow: '0 12px 28px -18px rgba(20, 24, 31, 0.2)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  sectionNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.12em',
  },
  sectionTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
  },
  sectionTitleLg: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
  },
  sectionRule: { flex: 1, height: 1, background: 'var(--line)' },
  notes: {
    margin: 0,
    padding: '14px 18px',
    borderLeft: '2px solid var(--accent)',
    background: 'var(--paper)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 15,
    color: 'var(--ink-soft)',
    lineHeight: 1.6,
  },
  nominalRow: {
    display: 'grid',
    gridTemplateColumns: '40px repeat(3, 1fr) auto',
    gap: 14,
    alignItems: 'center',
    padding: '10px 2px',
    borderBottom: '1px solid var(--line)',
    fontSize: 13,
  },
  nominalNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.1em',
  },
  nominalCol: {
    color: 'var(--ink-soft)',
    fontSize: 12.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nominalAmt: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink)',
    fontVariantNumeric: 'tabular-nums',
  },
  decisionNote: {
    margin: '0 0 18px',
    fontSize: 13,
    color: 'var(--ink-muted)',
    lineHeight: 1.55,
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
  },
  actionButtons: { display: 'flex', gap: 10 },
  reasonField: {
    marginTop: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--line-strong)',
    borderRadius: 7,
    fontSize: 13,
    minHeight: 84,
    resize: 'vertical',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    background: 'var(--paper)',
    color: 'var(--ink)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid var(--line-strong)',
    borderRadius: 7,
    fontSize: 13,
    background: 'var(--paper)',
    color: 'var(--ink)',
  },
  errorBanner: {
    marginTop: 14,
    background: 'var(--danger-soft)',
    border: '1px solid rgba(160, 49, 53, 0.25)',
    color: 'var(--danger)',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  bannerLabel: {
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  submitBtn: {
    marginTop: 18,
    width: '100%',
    padding: '14px',
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: '1px solid var(--ink)',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    textTransform: 'capitalize',
    letterSpacing: '0.01em',
  },
  submitArrow: { fontSize: 14, opacity: 0.7 },
  successPage: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '70vh',
    padding: 24,
  },
  successCard: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    padding: '42px 44px 34px',
    textAlign: 'center',
    maxWidth: 460,
    width: '100%',
    boxShadow: '0 24px 60px -30px rgba(20, 24, 31, 0.3)',
  },
  successKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  successTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 32,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  successEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  successText: {
    margin: '14px 0 0',
    fontSize: 14,
    color: 'var(--ink-muted)',
    lineHeight: 1.6,
  },
  successRule: {
    width: 40,
    height: 1,
    background: 'var(--accent)',
    margin: '24px auto',
  },
  successFoot: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 13,
    color: 'var(--ink-faint)',
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
