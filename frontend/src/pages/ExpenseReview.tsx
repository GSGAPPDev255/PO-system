import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useExpense, useSaveExpense, useSendExpenseApproval } from '../hooks/useExpenses';
import { useCompanyAccess } from '../hooks/useCompanyAccess';
import { supabase } from '../lib/supabase';
import type { ExpenseCategory, ExpenseStatus } from '../lib/supabase';
import { EXPENSE_CATEGORY_LABELS as LABELS } from '../lib/supabase';

const EDITABLE_STATUSES: ExpenseStatus[] = ['pending_finance_review', 'pending_approval', 'rejected'];

function fmtDate(raw: string | null): string {
  if (!raw) return '';
  return raw.slice(0, 10); // YYYY-MM-DD for input[type=date]
}

function validateForApproval(fields: {
  assigned_approver_id: string | null;
  gl_code: string | null;
  amount: number;
  employee_name: string | null;
  employee_email: string;
  category: string;
}): string[] {
  const errors: string[] = [];
  if (!fields.assigned_approver_id) errors.push('An approver must be assigned');
  if (!fields.gl_code) errors.push('GL Code is required');
  if (!fields.amount || Number(fields.amount) <= 0) errors.push('Amount must be greater than 0');
  if (Number(fields.amount) > 10000) errors.push('Amount must not exceed £10,000');
  if (!fields.employee_name && !fields.employee_email) errors.push('Employee name or email required');
  if (!fields.category) errors.push('Expense category is required');
  return errors;
}

export default function ExpenseReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: expense, isLoading, error } = useExpense(id!);
  const saveExpense = useSaveExpense();
  const sendApproval = useSendExpenseApproval();
  const { companies } = useCompanyAccess();

  // Approvers list
  const [approvers, setApprovers] = useState<{ id: string; display_name: string; email: string }[]>([]);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  // Local form state
  const [form, setForm] = useState({
    employee_name: '',
    employee_email: '',
    merchant_name: '',
    receipt_date: '',
    category: 'other' as ExpenseCategory,
    company: '',
    amount: '',
    currency: 'GBP',
    gl_code: '',
    cost_centre: '',
    department: '',
    description: '',
    assigned_approver_id: '',
    finance_notes: '',
  });

  const [saveError, setSaveError] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!expense) return;
    setForm({
      employee_name:         expense.employee_name ?? '',
      employee_email:        expense.employee_email ?? '',
      merchant_name:         expense.merchant_name ?? '',
      receipt_date:          fmtDate(expense.receipt_date),
      category:              expense.category ?? 'other',
      company:               (expense as unknown as Record<string, unknown>).company as string ?? '',
      amount:                expense.amount != null ? String(expense.amount) : '',
      currency:              expense.currency ?? 'GBP',
      gl_code:               expense.gl_code ?? '',
      cost_centre:           expense.cost_centre ?? '',
      department:            expense.department ?? '',
      description:           expense.description ?? '',
      assigned_approver_id:  expense.assigned_approver_id ?? '',
      finance_notes:         expense.finance_notes ?? '',
    });

    // Load receipt signed URL
    const fileRec = (expense as { expense_files?: { storage_path: string; bucket_name: string } }).expense_files;
    if (fileRec?.storage_path) {
      supabase.storage.from(fileRec.bucket_name).createSignedUrl(fileRec.storage_path, 3600)
        .then(({ data }) => { if (data) setReceiptUrl(data.signedUrl); });
    }
  }, [expense]);

  useEffect(() => {
    supabase.from('approvers').select('id, display_name, email').eq('is_active', true).order('display_name')
      .then(({ data }) => { if (data) setApprovers(data); });
  }, []);

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)' }}>Loading expense…</div>;
  if (error || !expense) return <div style={{ padding: 24, color: 'var(--danger)' }}>Expense not found.</div>;

  const isEditable = EDITABLE_STATUSES.includes(expense.status);
  const ocr = (expense as { ocr?: Array<{ extracted_fields: Record<string, unknown> }> }).ocr?.[0];
  const ocrFields = ocr?.extracted_fields ?? {};

  const handleSave = async () => {
    setSaveError([]);
    setSaved(false);
    try {
      await saveExpense.mutateAsync({
        id: expense.id,
        updates: {
          employee_name:         form.employee_name || null,
          employee_email:        form.employee_email,
          merchant_name:         form.merchant_name || null,
          receipt_date:          form.receipt_date || null,
          category:              form.category,
          company:               form.company || null,
          amount:                parseFloat(form.amount) || 0,
          currency:              form.currency,
          gl_code:               form.gl_code || null,
          cost_centre:           form.cost_centre || null,
          department:            form.department || null,
          description:           form.description || null,
          assigned_approver_id:  form.assigned_approver_id || null,
          finance_notes:         form.finance_notes || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError([(err as Error).message]);
    }
  };

  const handleSendForApproval = async () => {
    const errors = validateForApproval({
      assigned_approver_id: form.assigned_approver_id || null,
      gl_code: form.gl_code || null,
      amount: parseFloat(form.amount) || 0,
      employee_name: form.employee_name || null,
      employee_email: form.employee_email,
      category: form.category,
    });
    if (errors.length) { setSaveError(errors); return; }
    setSaveError([]);
    setSending(true);
    try {
      // Save first
      await saveExpense.mutateAsync({
        id: expense.id,
        updates: {
          employee_name:         form.employee_name || null,
          employee_email:        form.employee_email,
          merchant_name:         form.merchant_name || null,
          receipt_date:          form.receipt_date || null,
          category:              form.category,
          company:               form.company || null,
          amount:                parseFloat(form.amount) || 0,
          currency:              form.currency,
          gl_code:               form.gl_code || null,
          cost_centre:           form.cost_centre || null,
          department:            form.department || null,
          description:           form.description || null,
          assigned_approver_id:  form.assigned_approver_id || null,
          finance_notes:         form.finance_notes || null,
        },
      });
      const isResend = expense.status === 'pending_approval';
      await sendApproval.mutateAsync({ expense_id: expense.id, resend: isResend });
    } catch (err) {
      setSaveError([(err as Error).message]);
    } finally {
      setSending(false);
    }
  };

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div style={{ marginBottom: 16 }}>
      <label>{label}</label>
      {node}
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>{hint}</div>}
    </div>
  );

  const inp = (key: keyof typeof form, type = 'text', extra?: object) => (
    <input
      type={type}
      value={form[key]}
      disabled={!isEditable}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      style={{ width: '100%', marginTop: 6, ...extra }}
    />
  );

  return (
    <div>
      {/* Back nav */}
      <button className="btn btn-ghost" style={{ marginBottom: 20, fontSize: 12 }} onClick={() => navigate('/expenses')}>
        ← Back to Expenses
      </button>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.2em', fontFamily: 'var(--font-display)', marginBottom: 6 }}>
            Expense Review
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontFamily: 'var(--font-display)' }}>
            {expense.merchant_name ?? 'Receipt Review'}
          </h2>
          <div style={{ fontSize: 13, color: 'var(--ink-faint)', marginTop: 4 }}>
            {expense.employee_name ?? expense.employee_email} · £{Number(expense.amount).toFixed(2)}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
          {expense.status.replace(/_/g, ' ')}
        </div>
      </div>

      {/* Validation/error banner */}
      {saveError.length > 0 && (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--danger-soft)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Please fix the following:</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {saveError.map((e, i) => <li key={i} style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 2 }}>{e}</li>)}
            </ul>
          </div>
          <button onClick={() => setSaveError([])} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>
      )}

      {saved && (
        <div style={{ marginBottom: 20, padding: '10px 16px', background: 'var(--success-soft)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: 'var(--success)', fontSize: 13 }}>
          ✓ Changes saved
        </div>
      )}

      {/* Split layout: Receipt | Form */}
      <div className="split-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>

        {/* LEFT: Receipt viewer */}
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Receipt Image
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', minHeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {receiptUrl ? (
                <img
                  src={receiptUrl}
                  alt="Receipt"
                  style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--ink-faint)', padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
                  <div>No receipt image</div>
                </div>
              )}
            </div>
          </div>

          {/* OCR Comparison Panel */}
          {ocr && (
            <div className="card" style={{ marginTop: 16, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                AI Extraction
              </div>
              {[
                { key: 'merchant_name', label: 'Merchant' },
                { key: 'receipt_date', label: 'Date' },
                { key: 'amount', label: 'Amount' },
                { key: 'currency', label: 'Currency' },
                { key: 'category_hint', label: 'Category Hint' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                  <span style={{ color: 'var(--ink-faint)' }}>{label}</span>
                  <span style={{ color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {ocrFields[key] != null ? String(ocrFields[key]) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Form */}
        <div>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>
              Expense Details
            </div>

            {field('Employee Name', inp('employee_name'))}
            {field('Employee Email *', inp('employee_email', 'email'))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                {field('Merchant Name', inp('merchant_name'))}
              </div>
              <div>
                {field('Receipt Date', inp('receipt_date', 'date'))}
              </div>
            </div>

            {field('Company *',
              <select
                value={form.company}
                disabled={!isEditable}
                onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                style={{ width: '100%', marginTop: 6 }}
              >
                <option value="">Select company…</option>
                {companies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>,
              'Which company this expense belongs to',
            )}

            {field('Category *',
              <select
                value={form.category}
                disabled={!isEditable}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}
                style={{ width: '100%', marginTop: 6 }}
              >
                {(Object.entries(LABELS) as [ExpenseCategory, string][]).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                {field('Amount *',
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="10000"
                    value={form.amount}
                    disabled={!isEditable}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    style={{ width: '100%', marginTop: 6, fontFamily: 'var(--font-mono)' }}
                  />
                )}
              </div>
              <div>
                {field('Currency',
                  <select
                    value={form.currency}
                    disabled={!isEditable}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                    style={{ width: '100%', marginTop: 6 }}
                  >
                    {['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'CHF'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {field('Description', inp('description'), 'Max 200 characters')}

            {/* Accounting GL fields */}
            <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0', paddingTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
                Accounting Posting
              </div>
              {field('GL Code *', inp('gl_code'), 'e.g. 4100 — required for export')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>{field('Cost Centre', inp('cost_centre'))}</div>
                <div>{field('Department', inp('department'))}</div>
              </div>
            </div>

            {/* Approval */}
            <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0', paddingTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
                Approval
              </div>
              {field('Assigned Approver *',
                <select
                  value={form.assigned_approver_id}
                  disabled={!isEditable}
                  onChange={e => setForm(f => ({ ...f, assigned_approver_id: e.target.value }))}
                  style={{ width: '100%', marginTop: 6 }}
                >
                  <option value="">— Select approver —</option>
                  {approvers.map(a => (
                    <option key={a.id} value={a.id}>{a.display_name} ({a.email})</option>
                  ))}
                </select>
              )}
              {field('Finance Notes',
                <textarea
                  value={form.finance_notes}
                  disabled={!isEditable}
                  onChange={e => setForm(f => ({ ...f, finance_notes: e.target.value }))}
                  rows={3}
                  style={{ width: '100%', marginTop: 6, resize: 'vertical' }}
                  placeholder="Notes for the approver…"
                />
              )}
            </div>

            {/* Action buttons */}
            {isEditable && (
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={saveExpense.isPending}
                  onClick={handleSave}
                >
                  {saveExpense.isPending ? 'Saving…' : 'Save Draft'}
                </button>
                <button
                  className="btn btn-accent"
                  style={{ flex: 1 }}
                  disabled={sending}
                  onClick={handleSendForApproval}
                >
                  {sending ? 'Sending…' : expense.status === 'pending_approval' ? 'Amend & Resend' : 'Send for Approval →'}
                </button>
              </div>
            )}

            {!isEditable && (
              <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>
                {expense.status === 'approved' ? '✓ This expense has been approved' :
                 expense.status === 'exported' ? '✓ This expense has been exported' :
                 'This expense is read-only'}
              </div>
            )}

            {/* Approver decision if rejected */}
            {expense.status === 'rejected' && expense.rejected_reason && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--danger-soft)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Rejection Reason</div>
                <div style={{ fontSize: 13, color: 'rgba(240,244,255,0.8)' }}>{expense.rejected_reason}</div>
              </div>
            )}

            {expense.status === 'approved' && expense.approver_comments && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--success-soft)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Approver Comments</div>
                <div style={{ fontSize: 13, color: 'rgba(240,244,255,0.8)' }}>{expense.approver_comments}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
