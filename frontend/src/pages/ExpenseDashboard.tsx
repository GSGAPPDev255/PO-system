import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { useExpenses, useCreateExpense } from '../hooks/useExpenses';
import { useCompanyAccess } from '../hooks/useCompanyAccess';
import { supabase } from '../lib/supabase';
import type { ExpenseStatus, ExpenseCategory, EXPENSE_CATEGORY_LABELS } from '../lib/supabase';
import { EXPENSE_CATEGORY_LABELS as LABELS } from '../lib/supabase';

type FilterStatus = ExpenseStatus | 'all';

const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: 'All',              value: 'all' },
  { label: 'Pending Review',   value: 'pending_finance_review' },
  { label: 'Pending Approval', value: 'pending_approval' },
  { label: 'Approved',         value: 'approved' },
  { label: 'Rejected',         value: 'rejected' },
  { label: 'Exported',         value: 'exported' },
];

const STATUS_STYLE: Record<ExpenseStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  pending_finance_review: { label: 'Pending Review',   dot: 'var(--warning)', text: 'var(--warning)',    bg: 'var(--warning-soft)',  border: 'rgba(245,158,11,0.25)' },
  pending_approval:       { label: 'Pending Approval', dot: 'var(--accent)',  text: 'var(--accent-text)', bg: 'var(--accent-soft)',   border: 'rgba(0,198,224,0.25)' },
  approved:               { label: 'Approved',         dot: 'var(--success)', text: 'var(--success)',    bg: 'var(--success-soft)',  border: 'rgba(16,185,129,0.25)' },
  rejected:               { label: 'Rejected',         dot: 'var(--danger)',  text: 'var(--danger)',     bg: 'var(--danger-soft)',   border: 'rgba(244,63,94,0.25)' },
  exported:               { label: 'Exported',         dot: 'var(--ink-faint)', text: 'var(--ink-muted)', bg: 'rgba(255,255,255,0.04)', border: 'var(--line)' },
};

function fmtDate(raw: string | null): string {
  if (!raw) return '—';
  try {
    const d = parseISO(raw);
    return isValid(d) ? format(d, 'dd MMM yyyy') : '—';
  } catch { return '—'; }
}

function fmtMoney(amount: number | null, currency = 'GBP'): string {
  if (amount == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency + ' ';
  return `${sym}${Number(amount).toFixed(2)}`;
}

export default function ExpenseDashboard() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const { companies } = useCompanyAccess();

  const { data: expenses = [], isLoading, error } = useExpenses(
    statusFilter === 'all' ? undefined : statusFilter,
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter(e => {
      if (companyFilter !== 'all' && (e as unknown as Record<string, unknown>).company !== companyFilter) return false;
      if (!q) return true;
      return (
        (e.employee_name ?? '').toLowerCase().includes(q) ||
        (e.employee_email ?? '').toLowerCase().includes(q) ||
        (e.merchant_name ?? '').toLowerCase().includes(q) ||
        (e.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [expenses, search, companyFilter]);

  const totals = useMemo(() => {
    let total = 0, pending = 0, approved = 0;
    for (const e of expenses) {
      total += Number(e.amount ?? 0);
      if (e.status === 'pending_finance_review' || e.status === 'pending_approval') pending++;
      if (e.status === 'approved') approved++;
    }
    return { total, pending, approved };
  }, [expenses]);

  if (error) return (
    <div style={{ padding: 24, color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 8 }}>
      Failed to load expenses: {(error as Error).message}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <header style={styles.masthead} className="animate-rise page-masthead">
        <div>
          <div style={styles.pageEyebrow}>Expense Management</div>
          <h1 style={styles.pageTitle}>Expenses</h1>
          <p style={styles.pageSubtitle}>Receipt capture, review & approval workflow</p>
        </div>
        <button
          className="btn btn-accent"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          onClick={() => setShowUpload(true)}
        >
          <span style={{ fontSize: 16 }}>+</span> Upload Receipt
        </button>
      </header>

      {/* Stat cards */}
      <div style={styles.statsRow} className="animate-rise delay-1 stats-grid">
        {[
          { label: 'Total Value',       value: fmtMoney(totals.total),           color: 'var(--accent)' },
          { label: 'Awaiting Action',   value: String(totals.pending),            color: 'var(--warning)' },
          { label: 'Approved',          value: String(totals.approved),           color: 'var(--success)' },
          { label: 'Total Expenses',    value: String(expenses.length),           color: 'var(--ink-soft)' },
        ].map(stat => (
          <div key={stat.label} className="card" style={styles.statCard}>
            <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, fontFamily: 'var(--font-display)' }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div style={styles.toolbar} className="animate-rise delay-2 toolbar-row">
        <div style={styles.filterChips} className="filter-chips">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              style={{
                ...styles.chip,
                ...(statusFilter === f.value ? styles.chipActive : {}),
              }}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {companies.length > 1 && (
          <div style={styles.filterChips} className="filter-chips">
            {[{ name: 'All companies', slug: 'all' }, ...companies].map(c => (
              <button
                key={c.slug}
                style={{
                  ...styles.chip,
                  ...(companyFilter === c.slug
                    ? { ...styles.chipActive, background: 'var(--accent-3)', borderColor: 'var(--accent-3)' }
                    : {}),
                }}
                onClick={() => setCompanyFilter(c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          placeholder="Search employee, merchant…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 12px', fontSize: 13, borderRadius: 8, minWidth: 220 }}
        />
      </div>

      {/* Table / Cards */}
      <div className="card animate-rise delay-3" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)' }}>
            <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTop: '2px solid var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            Loading expenses…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-faint)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 14 }}>No expenses found</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>Upload a receipt to get started</div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="desktop-table table-scroll-wrapper">
              <table style={{ ...styles.table, display: 'table' }}>
                <thead>
                  <tr>
                    {['Employee', 'Merchant', 'Category', 'Receipt Date', 'Amount', 'Approver', 'Status', ''].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((exp, i) => {
                    const st = STATUS_STYLE[exp.status];
                    const approver = (exp as { approver?: { display_name?: string } }).approver;
                    return (
                      <tr key={exp.id} style={{ ...styles.tr, animationDelay: `${i * 0.03}s` }} onClick={() => navigate(`/expenses/${exp.id}`)}>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 500, color: 'var(--ink-soft)' }}>{exp.employee_name ?? exp.employee_email}</div>
                          {exp.employee_name && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{exp.employee_email}</div>}
                        </td>
                        <td style={styles.td}>{exp.merchant_name ?? <span style={{ color: 'var(--ink-faint)' }}>—</span>}</td>
                        <td style={styles.td}><span style={{ fontSize: 12 }}>{LABELS[exp.category] ?? exp.category}</span></td>
                        <td style={styles.td}>{fmtDate(exp.receipt_date)}</td>
                        <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)' }}>{fmtMoney(exp.amount, exp.currency)}</td>
                        <td style={styles.td}>{approver?.display_name ?? <span style={{ color: 'var(--ink-faint)' }}>Unassigned</span>}</td>
                        <td style={styles.td}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: st.text, background: st.bg, border: `1px solid ${st.border}` }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
                            {st.label}
                          </span>
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>
                          <button style={{ padding: '5px 12px', fontSize: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-muted)' }} onClick={e => { e.stopPropagation(); navigate(`/expenses/${exp.id}`); }}>
                            Review →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="mobile-cards" style={{ display: 'none' }}>
              {filtered.map(exp => {
                const st = STATUS_STYLE[exp.status];
                const approver = (exp as { approver?: { display_name?: string } }).approver;
                return (
                  <div key={exp.id} className="mobile-card-row" onClick={() => navigate(`/expenses/${exp.id}`)}>
                    <div className="mobile-card-row-top">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{exp.merchant_name ?? '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>{exp.employee_name ?? exp.employee_email}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>{fmtMoney(exp.amount, exp.currency)}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{fmtDate(exp.receipt_date)}</div>
                      </div>
                    </div>
                    <div className="mobile-card-row-meta">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: st.text, background: st.bg, border: `1px solid ${st.border}` }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: st.dot }} />
                        {st.label}
                      </span>
                      {approver?.display_name && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{approver.display_name}</span>}
                      <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{LABELS[exp.category] ?? exp.category}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [company, setCompany] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const navigate = useNavigate();
  const createExpense = useCreateExpense();
  const { companies } = useCompanyAccess();

  const handleSubmit = async () => {
    if (!file || !employeeEmail || !company) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const expense = await createExpense.mutateAsync({ file, employeeEmail, employeeName, category, company, userId: user.id });
      onClose();
      navigate(`/expenses/${expense.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} className="animate-rise modal-sheet" onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>Upload Receipt</h2>
          <button style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
        </div>

        {/* Drop zone */}
        <div
          style={{
            ...styles.dropZone,
            ...(dragOver ? styles.dropZoneActive : {}),
            ...(file ? styles.dropZoneHasFile : {}),
          }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
          onClick={() => document.getElementById('receipt-file-input')?.click()}
        >
          <input
            id="receipt-file-input"
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
          />
          {file ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🧾</div>
              <div style={{ color: 'var(--ink-soft)', fontWeight: 500 }}>{file.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 4 }}>
                {(file.size / 1024).toFixed(0)} KB — click to change
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--ink-faint)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📎</div>
              <div style={{ fontWeight: 500 }}>Drop receipt image here</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>or click to browse · JPEG, PNG, PDF</div>
            </div>
          )}
        </div>

        {/* Form fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
          <div>
            <label>Employee Email *</label>
            <input
              type="email"
              value={employeeEmail}
              onChange={e => setEmployeeEmail(e.target.value)}
              placeholder="jane.smith@company.com"
              style={{ width: '100%', marginTop: 6 }}
            />
          </div>
          <div>
            <label>Employee Name</label>
            <input
              type="text"
              value={employeeName}
              onChange={e => setEmployeeName(e.target.value)}
              placeholder="Jane Smith"
              style={{ width: '100%', marginTop: 6 }}
            />
          </div>
          <div>
            <label>Company *</label>
            <select
              value={company}
              onChange={e => setCompany(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            >
              <option value="">Select company…</option>
              {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Expense Category *</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as ExpenseCategory)}
              style={{ width: '100%', marginTop: 6 }}
            >
              {(Object.entries(LABELS) as [ExpenseCategory, string][]).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>
        </div>

        {createExpense.error && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--danger-soft)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
            {(createExpense.error as Error).message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-accent"
            disabled={!file || !employeeEmail || !company || createExpense.isPending}
            onClick={handleSubmit}
          >
            {createExpense.isPending ? 'Uploading & scanning…' : 'Upload & Start OCR'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  masthead: {
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageEyebrow: {
    fontSize: 9, fontWeight: 700, color: 'var(--ink-faint)',
    textTransform: 'uppercase', letterSpacing: '0.22em', fontFamily: 'var(--font-display)',
    marginBottom: 8,
  },
  pageTitle: {
    fontSize: 32, fontWeight: 800, margin: 0,
    background: 'linear-gradient(135deg, var(--ink) 0%, var(--ink-muted) 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
  },
  pageSubtitle: {
    fontSize: 13, color: 'var(--ink-faint)', margin: '6px 0 0',
  },
  statsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24,
  },
  statCard: {
    padding: '16px 20px',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16, gap: 16, flexWrap: 'wrap',
  },
  filterChips: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
  },
  chip: {
    padding: '5px 13px', borderRadius: 999, fontSize: 12, fontWeight: 500,
    background: 'transparent', border: '1px solid var(--line)',
    color: 'var(--ink-muted)', cursor: 'pointer', transition: 'all 0.15s',
  },
  chipActive: {
    background: 'var(--accent-soft)', border: '1px solid rgba(0,198,224,0.3)',
    color: 'var(--accent-text)',
  },
  table: {
    width: '100%', borderCollapse: 'collapse',
  },
  th: {
    padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em',
    borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-display)',
  },
  tr: {
    cursor: 'pointer', transition: 'background 0.12s',
    borderBottom: '1px solid var(--line)',
  },
  td: {
    padding: '13px 16px', fontSize: 13, color: 'var(--ink-soft)',
  },
  modalBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#0D1228', border: '1px solid var(--line-strong)',
    borderRadius: 16, padding: 28, width: 500, maxWidth: '95vw',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
  },
  dropZone: {
    border: '2px dashed var(--line-strong)', borderRadius: 12,
    padding: '32px 24px', cursor: 'pointer', transition: 'all 0.2s',
    background: 'rgba(255,255,255,0.02)',
  },
  dropZoneActive: {
    border: '2px dashed var(--accent)', background: 'var(--accent-soft)',
  },
  dropZoneHasFile: {
    border: '2px solid var(--success)', background: 'var(--success-soft)',
  },
};
