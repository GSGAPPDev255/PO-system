/**
 * MyExpenseDetail — Staff view/edit of a single submitted expense.
 * - GL code / cost centre / department are finance-only; not shown here.
 * - OCR scans the receipt automatically; fields auto-fill via polling.
 * - Editable only when status is pending_finance_review or rejected.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { useExpense, useSaveExpense } from '../hooks/useExpenses';
import { supabase } from '../lib/supabase';
import type { ExpenseCategory } from '../lib/supabase';
import { EXPENSE_CATEGORY_LABELS } from '../lib/supabase';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fmtDate(raw: string | null): string {
  if (!raw) return '—';
  try { const d = parseISO(raw); return isValid(d) ? format(d, 'dd MMM yyyy') : '—'; }
  catch { return '—'; }
}

function fmtMoney(amount: number | null, currency = 'GBP'): string {
  if (amount == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : (currency + ' ');
  return `${sym}${Number(amount).toFixed(2)}`;
}

function secondsSince(iso: string | null): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

/* ── status banner config ────────────────────────────────────────────────── */

const STATUS_BANNER: Record<string, {
  icon: string; title: string; body: string; color: string; bg: string; border: string;
}> = {
  pending_finance_review: {
    icon: '🔍',
    title: 'Under Review by Finance',
    body: 'Your expense is in the finance queue. You can still correct any details while it\'s pending.',
    color: 'var(--warning)',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
  },
  pending_approval: {
    icon: '📨',
    title: 'Awaiting Manager Approval',
    body: 'Finance have reviewed your expense and sent it to your approver. No further action needed from you.',
    color: '#00C6E0',
    bg: 'rgba(0,198,224,0.08)',
    border: 'rgba(0,198,224,0.25)',
  },
  approved: {
    icon: '✅',
    title: 'Approved',
    body: 'Your expense claim has been approved and will be included in the next payment run.',
    color: 'var(--success)',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.3)',
  },
  rejected: {
    icon: '❌',
    title: 'Rejected — Action Required',
    body: 'Your expense was not approved. Review the reason below, correct the details and save.',
    color: 'var(--danger)',
    bg: 'rgba(244,63,94,0.08)',
    border: 'rgba(244,63,94,0.3)',
  },
  exported: {
    icon: '💳',
    title: 'Processed for Payment',
    body: 'This expense has been exported to payroll and will appear in your next payment.',
    color: 'var(--ink-muted)',
    bg: 'rgba(255,255,255,0.04)',
    border: 'var(--line)',
  },
};

/* ── OCR scanning banner ─────────────────────────────────────────────────── */

function OcrScanningBanner() {
  return (
    <div style={styles.scanBanner}>
      <span style={styles.scanPulse} />
      <div>
        <div style={styles.scanTitle}>Scanning your receipt…</div>
        <div style={styles.scanBody}>
          AI is reading your receipt — merchant, date and amount will fill in automatically.
        </div>
      </div>
    </div>
  );
}

/* ── OcrChip — show what AI read vs what you entered ─────────────────────── */

function OcrChip({ ocrVal, currentVal }: { ocrVal: unknown; currentVal: unknown }) {
  if (!ocrVal) return null;
  const differ = String(ocrVal).trim() !== String(currentVal ?? '').trim();
  return (
    <div style={{
      display: 'inline-flex', gap: 6, alignItems: 'center',
      fontSize: 11, marginTop: 4,
      color:      differ ? 'var(--warning)' : 'var(--success)',
      background: differ ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)',
      border:    `1px solid ${differ ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}`,
      borderRadius: 6, padding: '3px 8px',
    }}>
      <span>{differ ? '⚠' : '✓'}</span>
      <span>AI read: <strong>{String(ocrVal)}</strong></span>
      {differ && <span style={{ color: 'var(--ink-muted)' }}>(you changed it)</span>}
    </div>
  );
}

/* ── main component ──────────────────────────────────────────────────────── */

export default function MyExpenseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // OCR polling: poll every 3 s for the first 90 s after creation if no OCR yet
  const [pollInterval, setPollInterval] = useState<number | false>(3000);
  const { data: expense, isLoading, error } = useExpense(id ?? '', {
    refetchInterval: pollInterval,
  });

  // Stop polling once OCR data arrives or timeout
  useEffect(() => {
    if (!expense) return;
    const hasOcr = Array.isArray((expense as { ocr?: unknown[] }).ocr)
      && ((expense as { ocr?: unknown[] }).ocr?.length ?? 0) > 0;
    const tooOld = secondsSince(expense.created_at) > 90;
    if (hasOcr || tooOld) setPollInterval(false);
  }, [expense]);

  const saveExpense = useSaveExpense();
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  // Form state
  const [category,    setCategory]    = useState<ExpenseCategory>('other');
  const [merchant,    setMerchant]    = useState('');
  const [receiptDate, setReceiptDate] = useState('');
  const [amount,      setAmount]      = useState('');
  const [currency,    setCurrency]    = useState('GBP');
  const [description, setDescription] = useState('');
  const [dirty,       setDirty]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null);
  const [saveErr,     setSaveErr]     = useState<string | null>(null);
  const [populated,   setPopulated]   = useState(false);

  // Populate form from fetched expense (only once; after that user edits take priority)
  useEffect(() => {
    if (!expense || populated) return;
    const ocrFields = (expense as { ocr?: { extracted_fields?: Record<string, unknown> }[] }).ocr?.[0]?.extracted_fields;

    // Prefer OCR values when the DB fields are still empty/zero
    setCategory((expense.category as ExpenseCategory) || 'other');
    setMerchant(expense.merchant_name ?? (ocrFields?.merchant_name as string) ?? '');
    setReceiptDate(
      expense.receipt_date
        ? expense.receipt_date.substring(0, 10)
        : (ocrFields?.receipt_date as string)?.substring(0, 10) ?? ''
    );
    const amt = expense.amount ?? (ocrFields?.amount as number) ?? null;
    setAmount(amt != null && amt !== 0 ? String(amt) : '');
    setCurrency(expense.currency ?? 'GBP');
    setDescription(expense.description ?? '');

    // Mark populated once we have real data (not just empty defaults)
    if (expense.merchant_name || (ocrFields && Object.keys(ocrFields).length > 0)) {
      setPopulated(true);
    }
  }, [expense, populated]);

  // Reload signed URL when file changes
  useEffect(() => {
    if (!expense?.expense_files) return;
    const file = expense.expense_files as { storage_path: string; bucket_name: string };
    if (!file?.storage_path) return;
    supabase.storage
      .from(file.bucket_name || 'expenses')
      .createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setReceiptUrl(data.signedUrl); });
  }, [expense]);

  const canEdit = expense?.status === 'pending_finance_review' || expense?.status === 'rejected';
  const isScanning = pollInterval !== false && !((expense as { ocr?: unknown[] } | undefined)?.ocr?.length);

  function markDirty() { setDirty(true); setSaveMsg(null); setSaveErr(null); }

  async function handleSave() {
    if (!expense || !canEdit) return;
    setSaving(true); setSaveErr(null); setSaveMsg(null);
    try {
      const amtNum = parseFloat(amount);
      if (isNaN(amtNum) || amtNum <= 0) throw new Error('Please enter a valid amount greater than zero');
      await saveExpense.mutateAsync({
        id: expense.id,
        updates: {
          category,
          merchant_name: merchant.trim() || null,
          receipt_date: receiptDate || null,
          amount: amtNum,
          currency,
          description: description.trim() || null,
          ...(expense.status === 'rejected'
            ? { status: 'pending_finance_review', rejected_reason: null }
            : {}),
        },
      });
      setSaveMsg(expense.status === 'rejected' ? '✓ Resubmitted for review' : '✓ Saved');
      setDirty(false);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /* ── loading / error states ───────────────────────────────────────────── */

  if (isLoading && !expense) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
      <div style={styles.spinner} />
    </div>
  );
  if (error || !expense) return (
    <div style={{ padding: 24, color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 8 }}>
      {error ? (error as Error).message : 'Expense not found'}
    </div>
  );

  const banner  = STATUS_BANNER[expense.status] ?? STATUS_BANNER.pending_finance_review;
  const ocr     = (expense as { ocr?: { extracted_fields?: Record<string, unknown> }[] }).ocr?.[0]?.extracted_fields ?? null;
  const expFile = expense.expense_files as { storage_path?: string; bucket_name?: string; mime_type?: string; original_name?: string } | null;
  const isImage = expFile?.mime_type?.startsWith('image/');

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <div style={styles.page}>
      {/* Back */}
      <button className="back-btn" style={styles.backBtn} onClick={() => navigate('/my-expenses')}>
        ← My Expenses
      </button>

      {/* OCR scanning indicator */}
      {isScanning && <OcrScanningBanner />}

      {/* Status banner */}
      {!isScanning && (
        <div style={{ ...styles.banner, background: banner.bg, borderColor: banner.border }}>
          <span style={styles.bannerIcon}>{banner.icon}</span>
          <div>
            <div style={{ ...styles.bannerTitle, color: banner.color }}>{banner.title}</div>
            <div style={styles.bannerBody}>{banner.body}</div>
          </div>
        </div>
      )}

      {/* Rejection reason */}
      {expense.status === 'rejected' && expense.rejected_reason && (
        <div style={styles.rejectionBox}>
          <div style={styles.rejectionLabel}>Rejection Reason</div>
          <div style={styles.rejectionText}>{expense.rejected_reason}</div>
        </div>
      )}

      <div className="split-layout" style={styles.splitLayout}>
        {/* ── Left: receipt ─────────────────────────────────────────── */}
        <div style={styles.receiptPanel}>
          {receiptUrl && isImage ? (
            <img src={receiptUrl} alt="Receipt" style={styles.receiptImg} />
          ) : receiptUrl ? (
            <div style={styles.pdfPlaceholder}>
              <div style={{ fontSize: 52, marginBottom: 14 }}>📄</div>
              <a href={receiptUrl} target="_blank" rel="noreferrer" style={styles.pdfLink}>
                Open Receipt PDF ↗
              </a>
            </div>
          ) : (
            <div style={styles.noReceipt}>
              <span style={{ fontSize: 40 }}>🖼️</span>
              <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No receipt attached</span>
            </div>
          )}

          <div style={styles.metaRow}>
            {expFile?.original_name && (
              <span style={styles.metaPill}>{expFile.original_name}</span>
            )}
            <span style={styles.metaPill}>Submitted {fmtDate(expense.created_at)}</span>
          </div>

          {/* Snapshot summary */}
          <div style={styles.summaryBox}>
            {[
              { key: 'Amount',   val: fmtMoney(expense.amount, expense.currency) },
              { key: 'Category', val: EXPENSE_CATEGORY_LABELS[expense.category as ExpenseCategory] ?? expense.category },
              ...(expense.merchant_name ? [{ key: 'Merchant', val: expense.merchant_name }] : []),
              ...(expense.receipt_date  ? [{ key: 'Date',     val: fmtDate(expense.receipt_date) }] : []),
            ].map(row => (
              <div key={row.key} style={styles.summaryRow}>
                <span style={styles.summaryKey}>{row.key}</span>
                <span style={styles.summaryVal}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: form ─────────────────────────────────────────────── */}
        <div style={styles.formPanel}>
          <h2 style={styles.formTitle}>{canEdit ? 'Edit Details' : 'Expense Details'}</h2>
          {!canEdit && (
            <p style={styles.readOnlyNote}>
              This expense is <strong>{expense.status.replace(/_/g, ' ')}</strong> and cannot be edited.
            </p>
          )}

          {/* Category */}
          <div style={styles.field}>
            <label style={styles.label}>Category</label>
            <select
              style={{ ...styles.input, ...(!canEdit ? styles.inputDisabled : {}) }}
              value={category}
              onChange={e => { setCategory(e.target.value as ExpenseCategory); markDirty(); }}
              disabled={!canEdit}
            >
              {(Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][]).map(
                ([k, v]) => <option key={k} value={k}>{v}</option>
              )}
            </select>
          </div>

          {/* Merchant */}
          <div style={styles.field}>
            <label style={styles.label}>Merchant / Supplier</label>
            <input
              style={{ ...styles.input, ...(!canEdit ? styles.inputDisabled : {}) }}
              value={merchant}
              onChange={e => { setMerchant(e.target.value); markDirty(); }}
              disabled={!canEdit}
              placeholder="e.g. Premier Inn, Tesco, Amazon"
            />
            {ocr && <OcrChip ocrVal={ocr.merchant_name} currentVal={merchant} />}
          </div>

          {/* Date + Amount */}
          <div style={styles.twoCol}>
            <div style={styles.field}>
              <label style={styles.label}>Receipt Date</label>
              <input
                type="date"
                style={{ ...styles.input, ...(!canEdit ? styles.inputDisabled : {}) }}
                value={receiptDate}
                onChange={e => { setReceiptDate(e.target.value); markDirty(); }}
                disabled={!canEdit}
              />
              {ocr && <OcrChip ocrVal={ocr.receipt_date} currentVal={receiptDate} />}
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Amount</label>
              <div style={styles.amountRow}>
                <select
                  style={{ ...styles.currencySelect, ...(!canEdit ? styles.inputDisabled : {}) }}
                  value={currency}
                  onChange={e => { setCurrency(e.target.value); markDirty(); }}
                  disabled={!canEdit}
                >
                  {['GBP', 'USD', 'EUR', 'AED', 'CAD'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ ...styles.input, ...(!canEdit ? styles.inputDisabled : {}), flex: 1 }}
                  value={amount}
                  onChange={e => { setAmount(e.target.value); markDirty(); }}
                  disabled={!canEdit}
                  placeholder="0.00"
                />
              </div>
              {ocr && <OcrChip ocrVal={ocr.amount} currentVal={amount} />}
            </div>
          </div>

          {/* Description */}
          <div style={styles.field}>
            <label style={styles.label}>
              Description
              <span style={styles.charCount}>{description.length}/200</span>
            </label>
            <textarea
              style={{ ...styles.textarea, ...(!canEdit ? styles.inputDisabled : {}) }}
              value={description}
              onChange={e => { if (e.target.value.length <= 200) { setDescription(e.target.value); markDirty(); } }}
              disabled={!canEdit}
              rows={3}
              placeholder="Brief description of what this expense is for…"
            />
          </div>

          {/* Approver comments (read-only) */}
          {expense.approver_comments && (
            <div style={styles.commentsBox}>
              <div style={styles.commentsLabel}>Approver's Comments</div>
              <div style={styles.commentsText}>{expense.approver_comments}</div>
            </div>
          )}

          {/* Save / resubmit */}
          {canEdit && (
            <div style={styles.actions}>
              <button
                style={{
                  ...styles.saveBtn,
                  ...(!dirty || saving ? styles.saveBtnDisabled : {}),
                }}
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? (
                  <><span style={styles.btnSpinner} /> Saving…</>
                ) : expense.status === 'rejected' ? (
                  'Resubmit for Review'
                ) : (
                  'Save Changes'
                )}
              </button>
              {saveMsg && <span style={styles.saveMsg}>{saveMsg}</span>}
              {saveErr && <span style={styles.saveErr}>{saveErr}</span>}
            </div>
          )}

          {/* Finance info note — no editable fields, just a note */}
          <div style={styles.financeNote}>
            <span style={styles.financeNoteIcon}>ℹ️</span>
            Finance will add coding details (GL code, cost centre) during their review.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto' },
  spinner: {
    width: 32, height: 32,
    border: '3px solid rgba(255,255,255,0.08)',
    borderTop: '3px solid #00C6E0',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  backBtn: {
    background: 'none', border: 'none',
    color: 'var(--ink-muted)', fontSize: 12,
    cursor: 'pointer', fontFamily: 'var(--font-body)',
    padding: '0 0 16px', display: 'block',
  },

  // OCR scanning banner
  scanBanner: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    padding: '14px 18px', marginBottom: 20,
    background: 'rgba(0,198,224,0.06)',
    border: '1px solid rgba(0,198,224,0.25)',
    borderRadius: 12,
  },
  scanPulse: {
    flexShrink: 0, marginTop: 2,
    width: 12, height: 12, borderRadius: '50%',
    background: '#00C6E0',
    boxShadow: '0 0 0 0 rgba(0,198,224,0.5)',
    animation: 'pulse 1.4s ease-in-out infinite',
    display: 'inline-block',
  },
  scanTitle: { fontWeight: 700, fontSize: 14, color: '#00C6E0', marginBottom: 3 },
  scanBody:  { fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.5 },

  banner: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    padding: '14px 18px', borderRadius: 12,
    border: '1px solid', marginBottom: 20,
  },
  bannerIcon:  { fontSize: 22, flexShrink: 0, marginTop: 2 },
  bannerTitle: { fontWeight: 700, fontSize: 14, marginBottom: 3 },
  bannerBody:  { fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.5 },

  rejectionBox: {
    background: 'rgba(244,63,94,0.08)',
    border: '1px solid rgba(244,63,94,0.3)',
    borderRadius: 10, padding: '12px 16px', marginBottom: 20,
  },
  rejectionLabel: { fontSize: 10, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 },
  rejectionText:  { fontSize: 14, color: 'var(--ink)' },

  splitLayout: { display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'start' },

  receiptPanel: { position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  receiptImg: {
    width: '100%', borderRadius: 12,
    border: '1px solid var(--line)', display: 'block',
    objectFit: 'contain', background: 'rgba(255,255,255,0.03)',
  },
  pdfPlaceholder: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: 200, background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--line)', borderRadius: 12,
  },
  pdfLink: { color: '#00C6E0', fontSize: 14, textDecoration: 'none', fontWeight: 600 },
  noReceipt: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: 180, background: 'rgba(255,255,255,0.03)',
    border: '1px dashed var(--line)', borderRadius: 12, gap: 8,
  },
  metaRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  metaPill: {
    fontSize: 10, color: 'var(--ink-muted)',
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)',
    borderRadius: 20, padding: '3px 9px',
  },
  summaryBox: {
    background: 'var(--glass)', border: '1px solid var(--line)',
    borderRadius: 10, overflow: 'hidden', backdropFilter: 'blur(10px)',
  },
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  summaryKey: { fontSize: 12, color: 'var(--ink-muted)' },
  summaryVal: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' },

  formPanel: {
    background: 'var(--glass)', border: '1px solid var(--line)',
    borderRadius: 14, padding: 24, backdropFilter: 'blur(12px)',
  },
  formTitle:    { margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-display)' },
  readOnlyNote: { margin: '0 0 20px', fontSize: 13, color: 'var(--ink-muted)' },

  field:     { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 },
  label:     { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  charCount: { fontWeight: 400, color: 'var(--ink-faint)' },

  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'var(--ink)',
    padding: '10px 12px', fontSize: 14,
    fontFamily: 'var(--font-body)', outline: 'none',
    width: '100%', boxSizing: 'border-box' as const,
  },
  inputDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  textarea: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'var(--ink)',
    padding: '10px 12px', fontSize: 14,
    fontFamily: 'var(--font-body)', outline: 'none',
    width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const,
  },
  twoCol:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  amountRow:     { display: 'flex', gap: 8 },
  currencySelect: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'var(--ink)',
    padding: '10px 8px', fontSize: 13,
    fontFamily: 'var(--font-body)', width: 72, flexShrink: 0,
  },

  commentsBox:   { background: 'rgba(0,198,224,0.05)', border: '1px solid rgba(0,198,224,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 },
  commentsLabel: { fontSize: 10, fontWeight: 700, color: '#00C6E0', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 },
  commentsText:  { fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 },

  actions:        { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 20 },
  saveBtn: {
    padding: '12px 24px',
    background: 'var(--brand-gradient)', color: '#fff',
    border: 'none', borderRadius: 10,
    fontSize: 14, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    boxShadow: '0 0 20px rgba(0,198,224,0.25)',
  },
  saveBtnDisabled: { opacity: 0.5, cursor: 'not-allowed', boxShadow: 'none' },
  btnSpinner: {
    width: 14, height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTop: '2px solid #fff',
    borderRadius: '50%', display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
  saveMsg: { fontSize: 13, color: 'var(--success)', fontWeight: 600 },
  saveErr: { fontSize: 13, color: 'var(--danger)' },

  financeNote: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    fontSize: 12, color: 'var(--ink-faint)',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8, padding: '10px 12px',
    marginTop: 8, lineHeight: 1.5,
  },
  financeNoteIcon: { flexShrink: 0 },
};
