import { useState, useMemo } from 'react';
import { useExpenses, useGenerateExpenseCsv } from '../hooks/useExpenses';
import { supabase } from '../lib/supabase';
import { EXPENSE_CATEGORY_LABELS as LABELS } from '../lib/supabase';
import type { ExpenseCategory } from '../lib/supabase';

function fmtMoney(amount: number | null, currency = 'GBP'): string {
  if (amount == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency + ' ';
  return `${sym}${Number(amount).toFixed(2)}`;
}

function fmtDate(raw: string | null): string {
  if (!raw) return '—';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

export default function ExpenseExport() {
  const { data: expenses = [], isLoading } = useExpenses('approved');
  const generateCsv = useGenerateExpenseCsv();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const allIds = useMemo(() => expenses.map(e => e.id), [expenses]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;

  const toggle = (id: string) =>
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allIds));

  const selectedTotal = useMemo(() => {
    return expenses.filter(e => selected.has(e.id)).reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  }, [expenses, selected]);

  const handleExport = async () => {
    if (!selected.size) return;
    setExportError(null);
    setDownloadUrl(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const result = await generateCsv.mutateAsync({
        expense_ids: Array.from(selected),
        exported_by_id: user?.id ?? '',
      });
      if (result.download_url) {
        setDownloadUrl(result.download_url);
        setSelected(new Set());
      }
    } catch (err) {
      const e = err as Error & { details?: { id: string; errors: string[] }[] };
      if (e.message?.includes('Validation failed') || (e as { details?: unknown }).details) {
        setExportError('Validation failed — some expenses have missing data. Review them first.');
      } else {
        setExportError(e.message);
      }
    }
  };

  return (
    <div>
      <header style={{ marginBottom: 28 }} className="animate-rise">
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.22em', fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Export Management
        </div>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', background: 'linear-gradient(135deg, var(--ink) 0%, var(--ink-muted) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Expense Export
        </h1>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-faint)', fontSize: 13 }}>
          Select approved expenses to export as accounting GL CSV
        </p>
      </header>

      {/* Download success banner */}
      {downloadUrl && (
        <div className="animate-rise" style={{ marginBottom: 20, padding: '14px 20px', background: 'var(--success-soft)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>✓ Export generated successfully</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 3 }}>CSV file ready for accounting system import</div>
          </div>
          <a href={downloadUrl} download style={{ padding: '10px 20px', background: 'var(--success)', color: '#07091A', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            ⬇ Download CSV
          </a>
        </div>
      )}

      {/* Error banner */}
      {exportError && (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--danger-soft)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--danger)', fontSize: 13 }}>⚠ {exportError}</span>
          <button onClick={() => setExportError(null)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* Export controls */}
      {selected.size > 0 && (
        <div className="card animate-rise" style={{ marginBottom: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--accent-soft)', border: '1px solid rgba(0,198,224,0.25)' }}>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: 'var(--accent-text)' }}>{selected.size} expense{selected.size !== 1 ? 's' : ''}</strong>
            <span style={{ color: 'var(--ink-muted)', marginLeft: 8 }}>selected · Total: <strong>{fmtMoney(selectedTotal)}</strong></span>
          </div>
          <button
            className="btn btn-accent"
            disabled={generateCsv.isPending}
            onClick={handleExport}
          >
            {generateCsv.isPending ? 'Generating CSV…' : `⬇ Export ${selected.size} Expense${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card animate-rise delay-1" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)' }}>Loading approved expenses…</div>
        ) : expenses.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center', color: 'var(--ink-faint)' }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>✓</div>
            <div style={{ fontSize: 15 }}>No approved expenses awaiting export</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>Expenses will appear here once approved by an approver</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', width: 14, height: 14 }} />
                </th>
                {['Employee', 'Merchant', 'Category', 'Receipt Date', 'Amount', 'GL Code', 'Approved'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-display)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map(exp => {
                const isChecked = selected.has(exp.id);
                const hasGl = !!exp.gl_code;
                return (
                  <tr key={exp.id} style={{ borderBottom: '1px solid var(--line)', background: isChecked ? 'rgba(0,198,224,0.04)' : undefined, cursor: 'pointer' }} onClick={() => toggle(exp.id)}>
                    <td style={{ padding: '12px 16px' }}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(exp.id)} style={{ cursor: 'pointer', width: 14, height: 14 }} onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>
                      <div style={{ fontWeight: 500 }}>{exp.employee_name ?? exp.employee_email}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink-muted)' }}>{exp.merchant_name ?? '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: 12 }}>{LABELS[exp.category as ExpenseCategory] ?? exp.category}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink-muted)' }}>{fmtDate(exp.receipt_date)}</td>
                    <td style={{ padding: '12px 14px', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                      {fmtMoney(exp.amount, exp.currency)}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13 }}>
                      {hasGl ? (
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', fontSize: 12 }}>{exp.gl_code}</span>
                      ) : (
                        <span style={{ color: 'var(--danger)', fontSize: 12 }}>⚠ Missing</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink-muted)' }}>{fmtDate(exp.approved_at)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderTop: '1px solid var(--line-strong)' }}>
                <td colSpan={5} style={{ padding: '12px 16px', fontSize: 12, color: 'var(--ink-faint)' }}>
                  {expenses.length} expense{expenses.length !== 1 ? 's' : ''} available
                </td>
                <td style={{ padding: '12px 14px', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                  {fmtMoney(expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
