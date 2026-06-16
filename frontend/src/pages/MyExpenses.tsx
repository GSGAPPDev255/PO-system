/**
 * MyExpenses — Staff expense submission portal
 * Staff users only: submit receipts, track approval status.
 */
import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, isValid, startOfMonth, endOfMonth } from 'date-fns';
import { useExpenses, useCreateExpense } from '../hooks/useExpenses';
import { useCompanyAccess } from '../hooks/useCompanyAccess';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
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

/* ── status config ───────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  pending_finance_review: {
    label: 'Under Review',
    tagline: 'Finance is reviewing your expense',
    dot: 'var(--warning)',
    text: 'var(--warning)',
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.25)',
  },
  pending_approval: {
    label: 'Awaiting Approval',
    tagline: 'Sent to your approver',
    dot: '#00C6E0',
    text: '#00C6E0',
    bg: 'rgba(0,198,224,0.1)',
    border: 'rgba(0,198,224,0.25)',
  },
  approved: {
    label: 'Approved',
    tagline: 'Your expense has been approved',
    dot: 'var(--success)',
    text: 'var(--success)',
    bg: 'rgba(16,185,129,0.1)',
    border: 'rgba(16,185,129,0.25)',
  },
  rejected: {
    label: 'Rejected',
    tagline: 'Action required — see details',
    dot: 'var(--danger)',
    text: 'var(--danger)',
    bg: 'rgba(244,63,94,0.1)',
    border: 'rgba(244,63,94,0.25)',
  },
  exported: {
    label: 'Paid',
    tagline: 'Processed for payment',
    dot: 'var(--ink-muted)',
    text: 'var(--ink-muted)',
    bg: 'rgba(255,255,255,0.04)',
    border: 'var(--line)',
  },
};

type FilterStatus = 'all' | 'pending_finance_review' | 'pending_approval' | 'approved' | 'rejected' | 'exported';

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: 'All',      value: 'all' },
  { label: 'Pending',  value: 'pending_finance_review' },
  { label: 'In Review',value: 'pending_approval' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

/* ── upload modal ────────────────────────────────────────────────────────── */

interface UploadModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

function UploadModal({ onClose, onCreated }: UploadModalProps) {
  const [step, setStep] = useState<'drop' | 'form'>('drop');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [company, setCompany] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createExpense = useCreateExpense();
  const { companies } = useCompanyAccess();

  const accept = useCallback((f: File) => {
    if (!f.type.startsWith('image/') && f.type !== 'application/pdf') {
      setErr('Please upload an image (JPG, PNG) or PDF receipt.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErr('File must be under 10 MB.');
      return;
    }
    setErr(null);
    setFile(f);
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
    setStep('form');
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) accept(f);
  }, [accept]);

  async function handleSubmit() {
    if (!file) return;
    if (!company) { setErr('Please choose the company this expense is for.'); return; }
    setErr(null);
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, email')
        .eq('id', user.id)
        .single();

      const expense = await createExpense.mutateAsync({
        file,
        employeeEmail: profile?.email ?? user.email ?? '',
        employeeName: profile?.display_name ?? user.email ?? '',
        category,
        company,
        userId: user.id,
      });

      onCreated(expense.id as string);
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div
        className="modal-sheet"
        style={modalStyles.sheet}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div style={modalStyles.handle} />

        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>
            {step === 'drop' ? 'Upload Receipt' : 'Expense Details'}
          </h2>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'drop' ? (
          <div
            style={{
              ...modalStyles.dropZone,
              ...(dragging ? modalStyles.dropZoneActive : {}),
            }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) accept(f); }}
            />
            <div style={modalStyles.dropIcon}>📄</div>
            <p style={modalStyles.dropText}>
              Drag & drop your receipt here<br />
              <span style={modalStyles.dropSub}>or tap to browse — JPG, PNG, PDF up to 10 MB</span>
            </p>
            {err && <p style={modalStyles.errText}>{err}</p>}
          </div>
        ) : (
          <div style={modalStyles.form}>
            {/* Preview */}
            {preview && (
              <div style={modalStyles.previewWrap}>
                <img src={preview} alt="Receipt preview" style={modalStyles.previewImg} />
                <div style={modalStyles.previewBadge}>
                  <span style={{ color: 'var(--success)' }}>✓</span> {file?.name}
                </div>
              </div>
            )}
            {!preview && file && (
              <div style={modalStyles.pdfPill}>
                📄 <strong>{file.name}</strong> uploaded
              </div>
            )}

            {/* Company */}
            <div style={modalStyles.field}>
              <label style={modalStyles.label}>Company</label>
              <select
                style={modalStyles.select}
                value={company}
                onChange={e => setCompany(e.target.value)}
              >
                <option value="">Select company…</option>
                {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
              {companies.length === 0 && (
                <p style={modalStyles.hint}>
                  You don't have access to any company yet — ask an admin to grant access.
                </p>
              )}
            </div>

            {/* Category */}
            <div style={modalStyles.field}>
              <label style={modalStyles.label}>Category</label>
              <select
                style={modalStyles.select}
                value={category}
                onChange={e => setCategory(e.target.value as ExpenseCategory)}
              >
                {(Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][]).map(
                  ([k, v]) => <option key={k} value={k}>{v}</option>
                )}
              </select>
            </div>

            <p style={modalStyles.hint}>
              Upload complete — OCR will auto-fill merchant, date and amount. You can correct
              any fields on the next screen.
            </p>

            {err && <p style={modalStyles.errText}>{err}</p>}

            <button
              style={{
                ...modalStyles.submitBtn,
                ...(submitting ? modalStyles.submitBtnDisabled : {}),
              }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <><span style={modalStyles.btnSpinner} /> Uploading…</>
              ) : (
                'Continue →'
              )}
            </button>

            <button style={modalStyles.backLink} onClick={() => setStep('drop')}>
              ← Choose a different file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────────────── */

export default function MyExpenses() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showUpload, setShowUpload] = useState(false);
  const { isInstallable, promptInstall, dismiss } = useInstallPrompt();

  const { data: expenses = [], isLoading, error } = useExpenses(
    filter === 'all' ? undefined : filter,
  );

  // Month stats (across all statuses — fetch full unfiltered list separately)
  const { data: allExpenses = [] } = useExpenses();

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd   = endOfMonth(now);

  const monthStats = allExpenses.reduce(
    (acc, e) => {
      const d = e.created_at ? parseISO(e.created_at) : null;
      const inMonth = d && d >= monthStart && d <= monthEnd;
      if (inMonth) acc.total += Number(e.amount ?? 0);
      if (e.status === 'pending_finance_review' || e.status === 'pending_approval') acc.pending++;
      if (e.status === 'approved') acc.approved++;
      acc.submitted++;
      return acc;
    },
    { total: 0, pending: 0, approved: 0, submitted: 0 },
  );

  function handleCreated(id: string) {
    setShowUpload(false);
    navigate(`/my-expenses/${id}`);
  }

  if (error) return (
    <div style={{ padding: 24, color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 8 }}>
      Failed to load expenses: {(error as Error).message}
    </div>
  );

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-masthead" style={styles.masthead}>
        <div>
          <h1 style={styles.heading}>My Expenses</h1>
          <p style={styles.sub}>Track and submit your expense claims</p>
        </div>
        <button style={styles.submitBtn} onClick={() => setShowUpload(true)}>
          <span style={styles.btnPlus}>+</span> Submit Expense
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="stats-grid" style={styles.statsGrid}>
        {[
          { label: 'This Month', value: fmtMoney(monthStats.total), sub: 'total claimed' },
          { label: 'Submitted',  value: String(monthStats.submitted), sub: 'all time' },
          { label: 'Pending',    value: String(monthStats.pending),   sub: 'awaiting action' },
          { label: 'Approved',   value: String(monthStats.approved),  sub: 'all time' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={styles.statCard}>
            <div style={styles.statLabel}>{s.label}</div>
            <div style={styles.statValue}>{s.value}</div>
            <div style={styles.statSub}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Install banner ──────────────────────────────────────────────── */}
      {isInstallable && (
        <div style={styles.installBanner}>
          <div style={styles.installLeft}>
            <span style={styles.installIcon}>📲</span>
            <div>
              <div style={styles.installTitle}>Add to Home Screen</div>
              <div style={styles.installSub}>Submit expenses straight from your phone — no browser needed.</div>
            </div>
          </div>
          <div style={styles.installActions}>
            <button style={styles.installBtn} onClick={promptInstall}>Install</button>
            <button style={styles.installDismiss} onClick={dismiss}>✕</button>
          </div>
        </div>
      )}

      {/* ── Filter tabs ────────────────────────────────────────────────── */}
      <div className="filter-chips" style={styles.filterRow}>
        {FILTERS.map(f => (
          <button
            key={f.value}
            style={{
              ...styles.chip,
              ...(filter === f.value ? styles.chipActive : {}),
            }}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── List ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={styles.empty}>
          <div style={styles.spinner} />
        </div>
      ) : expenses.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🧾</div>
          <p style={styles.emptyTitle}>No expenses yet</p>
          <p style={styles.emptySub}>
            {filter === 'all'
              ? 'Submit your first expense claim by uploading a receipt.'
              : `No expenses with status "${filter.replace(/_/g, ' ')}".`}
          </p>
          {filter === 'all' && (
            <button style={styles.submitBtn} onClick={() => setShowUpload(true)}>
              Submit Your First Expense
            </button>
          )}
        </div>
      ) : (
        <div style={styles.list}>
          {expenses.map(exp => {
            const cfg = STATUS_CONFIG[exp.status] ?? STATUS_CONFIG.pending_finance_review;
            return (
              <div
                key={exp.id}
                style={styles.card}
                onClick={() => navigate(`/my-expenses/${exp.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/my-expenses/${exp.id}`)}
              >
                {/* Left: category + details */}
                <div style={styles.cardLeft}>
                  <div style={styles.catEmoji}>
                    {EXPENSE_CATEGORY_LABELS[exp.category]?.split(' ')[0] ?? '📋'}
                  </div>
                  <div style={styles.cardMeta}>
                    <div style={styles.cardMerchant}>
                      {exp.merchant_name ?? EXPENSE_CATEGORY_LABELS[exp.category]?.split(' ').slice(1).join(' ') ?? 'Expense'}
                    </div>
                    <div style={styles.cardDate}>{fmtDate(exp.receipt_date ?? exp.created_at)}</div>
                  </div>
                </div>

                {/* Right: amount + status */}
                <div style={styles.cardRight}>
                  <div style={styles.cardAmount}>{fmtMoney(exp.amount, exp.currency)}</div>
                  <div style={{
                    ...styles.badge,
                    color: cfg.text,
                    background: cfg.bg,
                    borderColor: cfg.border,
                  }}>
                    <span style={{ ...styles.badgeDot, background: cfg.dot }} />
                    {cfg.label}
                  </div>
                </div>

                <div style={styles.cardChevron}>›</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Upload modal ────────────────────────────────────────────────── */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: '0 auto' },
  masthead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 28,
    flexWrap: 'wrap',
    gap: 14,
  },
  heading: {
    margin: 0,
    fontSize: '1.65rem',
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
  },
  sub: { margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontWeight: 400 },

  submitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 20px',
    background: 'var(--brand-gradient)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    letterSpacing: '0.02em',
    boxShadow: '0 0 20px rgba(0,198,224,0.25)',
  },
  btnPlus: { fontSize: 16, lineHeight: 1 },

  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    background: 'var(--glass)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '16px 18px',
    backdropFilter: 'blur(12px)',
  },
  statLabel: { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6 },
  statValue: { fontSize: '1.45rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' },
  statSub:   { fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 },

  filterRow: {
    display: 'flex',
    gap: 6,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  chip: {
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid var(--line)',
    background: 'transparent',
    color: 'var(--ink-muted)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    transition: 'all 0.15s',
  },
  chipActive: {
    background: 'rgba(0,198,224,0.12)',
    borderColor: 'rgba(0,198,224,0.4)',
    color: '#00C6E0',
    fontWeight: 600,
  },

  empty: { display: 'flex', justifyContent: 'center', padding: 60 },
  spinner: {
    width: 32, height: 32,
    border: '3px solid rgba(255,255,255,0.08)',
    borderTop: '3px solid #00C6E0',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  emptyState: {
    textAlign: 'center',
    padding: '64px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  emptyIcon:  { fontSize: 48, marginBottom: 8 },
  emptyTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' },
  emptySub:   { margin: 0, fontSize: 13, color: 'var(--ink-muted)', maxWidth: 320 },

  list: {
    background: 'var(--glass)',
    border: '1px solid var(--line)',
    borderRadius: 14,
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    cursor: 'pointer',
    transition: 'background 0.12s',
    userSelect: 'none',
  },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  catEmoji: { fontSize: 22, flexShrink: 0, width: 36, textAlign: 'center' },
  cardMeta: { minWidth: 0 },
  cardMerchant: { fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardDate:     { fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 },

  cardRight:  { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  cardAmount: { fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' },

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 9px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  badgeDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0 },

  cardChevron: { fontSize: 18, color: 'var(--ink-faint)', flexShrink: 0 },

  // Install banner
  installBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: '14px 18px',
    marginBottom: 16,
    background: 'rgba(0,198,224,0.07)',
    border: '1px solid rgba(0,198,224,0.25)',
    borderRadius: 12,
    flexWrap: 'wrap' as const,
  },
  installLeft:    { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 },
  installIcon:    { fontSize: 24, flexShrink: 0 },
  installTitle:   { fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 },
  installSub:     { fontSize: 12, color: 'var(--ink-muted)' },
  installActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  installBtn: {
    padding: '8px 18px',
    background: 'var(--brand-gradient)',
    color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13,
    fontWeight: 700, cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  installDismiss: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'var(--ink-muted)',
    width: 30, height: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontSize: 12,
    fontFamily: 'var(--font-body)',
  },
};

const modalStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
    zIndex: 500,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    background: 'rgba(14,18,40,0.97)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '20px 20px 0 0',
    width: '100%',
    maxWidth: 560,
    padding: '0 0 env(safe-area-inset-bottom)',
  },
  handle: {
    width: 40, height: 4,
    background: 'rgba(255,255,255,0.18)',
    borderRadius: 2,
    margin: '12px auto 0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 16px',
  },
  title: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--ink)',
    fontFamily: 'var(--font-display)',
  },
  closeBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: 'var(--ink-muted)',
    width: 30, height: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'var(--font-body)',
  },
  dropZone: {
    margin: '0 24px 24px',
    border: '2px dashed rgba(0,198,224,0.3)',
    borderRadius: 14,
    padding: '48px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: 'rgba(0,198,224,0.03)',
  },
  dropZoneActive: {
    borderColor: '#00C6E0',
    background: 'rgba(0,198,224,0.08)',
  },
  dropIcon: { fontSize: 48, marginBottom: 16 },
  dropText: { margin: 0, color: 'var(--ink)', fontSize: 14, lineHeight: 1.6 },
  dropSub:  { color: 'var(--ink-muted)', fontSize: 12 },
  errText:  { color: 'var(--danger)', fontSize: 12, marginTop: 10, margin: '10px 0 0' },

  form: { padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 },
  previewWrap: { position: 'relative', borderRadius: 12, overflow: 'hidden', maxHeight: 180 },
  previewImg:  { width: '100%', objectFit: 'cover', display: 'block' },
  previewBadge: {
    position: 'absolute',
    bottom: 8, left: 8,
    background: 'rgba(0,0,0,0.7)',
    color: '#fff',
    fontSize: 11,
    padding: '4px 8px',
    borderRadius: 6,
  },
  pdfPill: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--ink)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: 'var(--ink)',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'var(--font-body)',
    appearance: 'auto',
  },
  hint: { margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 },
  submitBtn: {
    padding: '13px 20px',
    background: 'var(--brand-gradient)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: '0 0 24px rgba(0,198,224,0.3)',
  },
  submitBtnDisabled: { opacity: 0.7, cursor: 'not-allowed' },
  btnSpinner: {
    width: 14, height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTop: '2px solid #fff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: 'var(--ink-muted)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    padding: 0,
    textAlign: 'center',
  },
};
