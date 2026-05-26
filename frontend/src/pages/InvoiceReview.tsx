import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useInvoice, useNominalLines, useVatLines, useOcrExtraction,
  useUpdateInvoice, useUpsertNominalLine, useUpsertVatLine,
} from '../hooks/useInvoices';
import { useMarkReadyForApproval, useApprovers, useAuditLog } from '../hooks/useApprovals';
import OcrComparisonPanel from '../components/invoice/OcrComparisonPanel';
import NominalLineEditor from '../components/invoice/NominalLineEditor';
import VatLineEditor from '../components/invoice/VatLineEditor';
import AuditTimeline from '../components/shared/AuditTimeline';
import StatusBadge from '../components/shared/StatusBadge';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { getInvoiceSignedUrl } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { PurchaseOrder, NominalLine, VatLine } from '../lib/supabase';

export default function InvoiceReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: po, isLoading } = useInvoice(id!);
  const { data: nominalLines = [] } = useNominalLines(id!);
  const { data: vatLines = [] } = useVatLines(id!);
  const { data: ocr } = useOcrExtraction(id!);
  const { data: approvers = [] } = useApprovers((po as unknown as Record<string, unknown>)?.company as string | null);
  const { data: auditLog = [] } = useAuditLog(id!);

  const qc = useQueryClient();
  const updateInvoice = useUpdateInvoice();
  const upsertNominal = useUpsertNominalLine();
  const upsertVat = useUpsertVatLine();
  const markReady = useMarkReadyForApproval();

  const [form, setForm] = useState<Partial<PurchaseOrder>>({});
  const [nominal1, setNominal1] = useState<Partial<NominalLine>>({});
  const [nominal2, setNominal2] = useState<Partial<NominalLine>>({});
  const [vat1, setVat1] = useState<Partial<VatLine>>({});
  const [vat2, setVat2] = useState<Partial<VatLine>>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [resubmitting, setResubmitting] = useState(false);

  useEffect(() => {
    if (po) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { invoice_file, approver, second_approver, approved_by,
              created_by, updated_by, forwarded_to, ...poFields } = po as Record<string, unknown>;
      setForm(poFields as Partial<PurchaseOrder>);
    }
  }, [po]);

  useEffect(() => {
    if (nominalLines[0]) setNominal1(nominalLines[0]);
    if (nominalLines[1]) setNominal2(nominalLines[1]);
  }, [nominalLines]);

  useEffect(() => {
    if (vatLines[0]) setVat1(vatLines[0]);
    if (vatLines[1]) setVat2(vatLines[1]);
  }, [vatLines]);

  useEffect(() => {
    if (po?.invoice_file_id) {
      const fileData = (po as Record<string, unknown>).invoice_file as { storage_path?: string } | null;
      if (fileData?.storage_path) {
        getInvoiceSignedUrl(fileData.storage_path).then(setPdfUrl);
      }
    }
  }, [po]);

  if (isLoading) return <div style={styles.loading}>Loading invoice…</div>;
  if (!po) return <div style={styles.error}>Invoice not found.</div>;

  const poData = po as PurchaseOrder & { invoice_file?: unknown; approver?: unknown };
  const isEditable = ['pending_finance_review', 'pending_approval', 'rejected'].includes(poData.status);

  const f = (key: keyof PurchaseOrder, label: string, type: 'text' | 'number' | 'date' | 'textarea' = 'text') => {
    const isMoney = type === 'number';
    const inputStyle: React.CSSProperties = {
      ...styles.input,
      ...(isMoney ? { fontFamily: 'var(--font-mono)', fontSize: 13 } : {}),
      ...(!isEditable ? styles.inputReadOnly : {}),
    };
    return (
      <div style={styles.field} key={key}>
        <label style={styles.label}>{label}</label>
        {type === 'textarea' ? (
          <textarea
            style={{ ...inputStyle, height: 68, resize: 'vertical', lineHeight: 1.5 }}
            value={String(form[key] ?? '')}
            readOnly={!isEditable}
            disabled={!isEditable}
            maxLength={key === 'description' ? 200 : undefined}
            onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value || null }))}
          />
        ) : (
          <input
            type={type}
            style={inputStyle}
            value={String(form[key] ?? '')}
            readOnly={!isEditable}
            disabled={!isEditable}
            onChange={(e) => setForm((prev) => ({
              ...prev,
              [key]: type === 'number' ? parseFloat(e.target.value) || null : e.target.value || null,
            }))}
          />
        )}
        {key === 'description' && (
          <span style={styles.charCount}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {String(form.description ?? '').length}
            </span>
            <span style={{ color: 'var(--ink-faint)' }}> / 75</span>
          </span>
        )}
      </div>
    );
  };

  const handleExtract = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const fileData = (poData as unknown as Record<string, unknown>).invoice_file as {
        storage_path?: string; mime_type?: string;
      } | null;
      if (!fileData?.storage_path) throw new Error('No file attached to this invoice');

      const { error: fnError, data: fnData } = await supabase.functions.invoke('invoice-processor', {
        body: {
          purchase_order_id: id,
          invoice_file_id: poData.invoice_file_id,
          storage_path: fileData.storage_path,
          mime_type: fileData.mime_type ?? 'application/pdf',
        },
      });

      if (fnError) throw new Error(fnError.message);
      const fnResult = fnData as Record<string, unknown> | null;
      if (fnResult?.error) throw new Error(String(fnResult.error));

      // Refresh PO + OCR data so the new values appear in the form
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['ocr', id] });
    } catch (e) {
      setExtractError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: { user } } = await import('../lib/supabase').then(m => m.supabase.auth.getUser());
      await updateInvoice.mutateAsync({ id: id!, updates: { ...form, finance_user_id: user?.id } });

      if (nominal1.nominal_account_number || nominal1.transaction_value) {
        await upsertNominal.mutateAsync({ ...nominal1, purchase_order_id: id!, line_number: 1 });
      }
      if (nominal2.nominal_account_number || nominal2.transaction_value) {
        await upsertNominal.mutateAsync({ ...nominal2, purchase_order_id: id!, line_number: 2 });
      }
      if (vat1.vat_code || vat1.tax_rate) {
        await upsertVat.mutateAsync({ ...vat1, purchase_order_id: id!, line_number: 1 });
      }
      if (vat2.vat_code || vat2.tax_rate) {
        await upsertVat.mutateAsync({ ...vat2, purchase_order_id: id!, line_number: 2 });
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError([(e as Error).message]);
    } finally {
      setSaving(false);
    }
  };

  const validateReadyForApproval = (): string[] => {
    const errors: string[] = [];

    // Required fields
    if (!form.supplier_name?.trim()) {
      errors.push('Supplier Name is required');
    }
    if (!form.transaction_date) {
      errors.push('Transaction Date is required');
    }
    if (!form.assigned_approver_id) {
      errors.push('A Primary Approver must be assigned');
    }

    // Amount validation: Net + VAT = Gross (±0.01)
    const net = Number(form.net_amount ?? 0);
    const vat = Number(form.vat_amount ?? 0);
    const gross = Number(form.gross_amount ?? 0);
    const TOLERANCE = 0.01;

    if (gross > 0 && Math.abs(net + vat - gross) > TOLERANCE) {
      errors.push(`Net (£${net.toFixed(2)}) + VAT (£${vat.toFixed(2)}) must equal Gross (£${gross.toFixed(2)})`);
    }

    return errors;
  };

  const handleMarkReady = async () => {
    const validationErrors = validateReadyForApproval();
    if (validationErrors.length > 0) {
      setSaveError(validationErrors);
      setShowConfirm(false);
      return;
    }

    setShowConfirm(false);
    try {
      // Auto-save any unsaved form changes before sending for approval
      await handleSave();
      await markReady.mutateAsync(id!);
    } catch (e) {
      setSaveError([(e as Error).message]);
    }
  };

  const handleResubmit = async () => {
    const validationErrors = validateReadyForApproval();
    if (validationErrors.length > 0) {
      setSaveError(validationErrors);
      return;
    }
    if (!confirm('Save changes and resubmit this invoice for approval? A new approval email will be sent to the approver.')) return;
    setResubmitting(true);
    setSaveError(null);
    try {
      // Save latest form changes first
      await handleSave();
      // Set status back to pending_approval
      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from('purchase_orders')
        .update({ status: 'pending_approval', updated_by_id: user?.id })
        .eq('id', id!);
      await supabase.from('audit_log').insert({
        purchase_order_id: id,
        action: 'status_changed',
        actor_id: user?.id,
        actor_email: user?.email,
        actor_display: 'Finance',
        new_values: { status: 'pending_approval' },
        metadata: { reason: 'Resubmitted after rejection — corrections applied' },
      });
      // Resend the approval email
      const { data: { session } } = await supabase.auth.getSession();
      const { error: fnError } = await supabase.functions.invoke('send-approval', {
        body: { purchase_order_id: id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (fnError) throw new Error(`Approval email failed: ${fnError.message}`);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    } catch (e) {
      setSaveError([(e as Error).message]);
    } finally {
      setResubmitting(false);
    }
  };

  const handleDismiss = async () => {
    setShowDismissConfirm(false);
    setDismissing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase
        .from('purchase_orders')
        .update({ status: 'dismissed', updated_by_id: user?.id })
        .eq('id', id!);
      await supabase.from('audit_log').insert({
        purchase_order_id: id,
        action: 'status_changed',
        actor_id: user?.id,
        actor_email: user?.email,
        actor_display: 'Finance',
        new_values: { status: 'dismissed' },
        metadata: { reason: 'Dismissed from invoice review — not applicable' },
      });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      navigate('/dashboard');
    } catch (e) {
      setSaveError([(e as Error).message]);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* Masthead */}
      <div style={styles.masthead} className="animate-rise">
        <button style={styles.back} onClick={() => navigate('/dashboard')}>
          <span style={styles.backArrow}>←</span> Back to ledger
        </button>

        <div style={styles.mastheadMain}>
          <div style={styles.titleRow}>
            <div>
              <div style={styles.kicker}>
                <span style={styles.kickerRule} /> Invoice Review
              </div>
              <h1 style={styles.title}>{poData.supplier_name ?? 'Unnamed Invoice'}</h1>
              <div style={styles.subtitle}>
                <span style={styles.subRef}>{poData.transaction_reference ?? '—'}</span>
                <span style={styles.subSep}>·</span>
                <StatusBadge status={poData.status} />
              </div>
            </div>

            {isEditable && (
              <div style={styles.headerActions}>
                {poData.status === 'pending_finance_review' && (
                  <button
                    className="btn"
                    style={styles.dismissBtn}
                    onClick={() => setShowDismissConfirm(true)}
                    disabled={dismissing}
                    title="Mark as not applicable and hide from the main view"
                  >
                    {dismissing ? 'Dismissing…' : '✕ Dismiss'}
                  </button>
                )}
                <button
                  className="btn"
                  style={styles.saveBtn}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                {poData.status === 'rejected' ? (
                  <div style={styles.approvalBtnWrap}>
                    <button
                      className="btn"
                      style={{
                        ...styles.approvalBtn,
                        background: 'linear-gradient(135deg, #7b61ff 0%, #00b4d8 100%)',
                        borderColor: '#7b61ff',
                        ...(form.assigned_approver_id ? {} : styles.approvalBtnDisabled),
                      }}
                      onClick={handleResubmit}
                      disabled={resubmitting || !form.assigned_approver_id}
                      title="Apply corrections and resend for approval"
                    >
                      {resubmitting ? 'Resubmitting…' : '↺ Fix & Resubmit'}
                      {!resubmitting && <span style={styles.approvalArrow}>→</span>}
                    </button>
                    {!form.assigned_approver_id && (
                      <span style={styles.approvalHint}>Assign an approver below</span>
                    )}
                  </div>
                ) : (
                  <div style={styles.approvalBtnWrap}>
                    <button
                      className="btn"
                      style={{
                        ...styles.approvalBtn,
                        ...(form.assigned_approver_id ? {} : styles.approvalBtnDisabled),
                      }}
                      onClick={() => setShowConfirm(true)}
                      disabled={!form.assigned_approver_id}
                      title={
                        form.assigned_approver_id
                          ? 'Send approval email to the assigned approver'
                          : 'Assign a Primary Approver below to enable this button'
                      }
                    >
                      Send for Approval
                      <span style={styles.approvalArrow}>→</span>
                    </button>
                    {!form.assigned_approver_id && (
                      <span style={styles.approvalHint}>
                        Assign a primary approver below
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {saveError && <div style={styles.errorBanner}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span style={styles.bannerLabel}>⚠ Validation Error</span>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, fontSize: 13 }}>
              {saveError.map((err, i) => (
                <li key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>{err}</li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => setSaveError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 20,
              padding: '0 0 0 16px',
            }}
          >
            ×
          </button>
        </div>
      </div>}
      {saveSuccess && <div style={styles.successBanner}>
        <span style={styles.bannerLabelSuccess}>Saved</span>
        Your changes are safe.
      </div>}

      {poData.status === 'rejected' && (
        <div style={styles.rejectedBanner}>
          <div style={styles.rejectedHeader}>
            <span style={styles.rejectedLabel}>✕ Invoice Rejected</span>
            <span style={styles.rejectedHint}>Correct the details below, then use "Fix &amp; Resubmit" to send for approval again.</span>
          </div>
          {!!(poData as unknown as Record<string, unknown>).rejected_reason && (
            <div style={styles.rejectedReason}>
              <span style={{ fontWeight: 600, marginRight: 6 }}>Reason:</span>
              {String((poData as unknown as Record<string, unknown>).rejected_reason)}
            </div>
          )}
        </div>
      )}

      <div style={styles.layout} className="split-layout">
        {/* Left: PDF viewer */}
        <div style={styles.pdfPanel} className="animate-rise delay-1">
          <div style={styles.pdfLabel}>§ Document</div>
          <div style={styles.pdfFrameWrap}>
            {pdfUrl ? (() => {
              const mime = ((poData as unknown as Record<string, unknown>).invoice_file as { mime_type?: string } | null)?.mime_type ?? '';
              const isImage = mime.startsWith('image/');
              return isImage ? (
                <img
                  src={pdfUrl}
                  alt="Invoice document"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <iframe
                  src={pdfUrl}
                  style={styles.pdfFrame}
                  title="Invoice document"
                />
              );
            })() : (
              <div style={styles.noPdf}>
                <div style={styles.noPdfMark}>§</div>
                <div style={styles.noPdfText}>No document available</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Form */}
        <div style={styles.formPanel} className="animate-rise delay-2">
          {/* Extract Data button — only show if no OCR has been run yet */}
          {!ocr && (
            <div style={{ marginBottom: 16 }}>
              <button
                className="btn"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: extracting ? 'not-allowed' : 'pointer',
                  opacity: extracting ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={handleExtract}
                disabled={extracting}
                title="Send the invoice to Claude AI to auto-fill fields"
              >
                {extracting ? (
                  <>⏳ Extracting data…</>
                ) : (
                  <>✦ Extract Data with AI</>
                )}
              </button>
              {extractError && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red, #e55)' }}>
                  {extractError}
                </div>
              )}
            </div>
          )}

          <OcrComparisonPanel ocr={ocr ?? null} po={poData} />

          <Section title="Supplier" number="01">
            <div style={styles.grid2}>
              {f('account_number', 'Account Number')}
              {f('supplier_name', 'Supplier Name')}
              {f('supplier_ref', 'Supplier Ref')}
              {f('supplier_ref_code', 'Supplier Ref Code')}
            </div>
          </Section>

          <Section title="Invoice" number="02">
            <div style={styles.grid2}>
              {f('transaction_reference', 'Invoice Number')}
              {f('second_reference', 'Second Reference')}
              {f('transaction_date', 'Invoice Date', 'date')}
              {f('due_date', 'Due Date', 'date')}
              {f('posting_date', 'Posting Date', 'date')}
            </div>
            <div style={{ marginTop: 14 }}>
              {f('description', 'Description (max 200 chars)', 'textarea')}
            </div>
          </Section>

          <Section title="Amounts" number="03">
            <div style={styles.grid3}>
              {f('net_amount', 'Net Amount', 'number')}
              {f('vat_amount', 'VAT Amount', 'number')}
              {f('gross_amount', 'Gross Amount', 'number')}
            </div>
          </Section>

          <Section title="Nominal Ledger Analysis" number="04">
            <NominalLineEditor lineNumber={1} value={nominal1} onChange={setNominal1} readOnly={!isEditable} />
            <NominalLineEditor lineNumber={2} value={nominal2} onChange={setNominal2} readOnly={!isEditable} />
          </Section>

          <Section title="VAT Analysis" number="05">
            <VatLineEditor lineNumber={1} value={vat1} onChange={setVat1} readOnly={!isEditable} />
            <VatLineEditor lineNumber={2} value={vat2} onChange={setVat2} readOnly={!isEditable} />
          </Section>

          <Section title="Approval Assignment" number="06">
            <div style={styles.grid2}>
              <div style={styles.field}>
                <label style={styles.label}>
                  Primary Approver <span style={styles.required}>*</span>
                </label>
                <select
                  style={{
                    ...styles.input,
                    ...(isEditable && !form.assigned_approver_id
                      ? { borderColor: 'var(--danger)', background: 'var(--danger-soft)' }
                      : {}),
                    ...(!isEditable ? styles.inputReadOnly : {}),
                  }}
                  value={form.assigned_approver_id ?? ''}
                  disabled={!isEditable}
                  onChange={(e) => setForm((p) => ({ ...p, assigned_approver_id: e.target.value || null }))}
                >
                  <option value="">Select approver…</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>{a.display_name} ({a.email})</option>
                  ))}
                </select>
                {isEditable && !form.assigned_approver_id && (
                  <span style={styles.fieldWarn}>
                    Required before approval can be sent
                  </span>
                )}
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Second Approver (optional)</label>
                <select
                  style={{ ...styles.input, ...(!isEditable ? styles.inputReadOnly : {}) }}
                  value={form.second_approver_id ?? ''}
                  disabled={!isEditable}
                  onChange={(e) => setForm((p) => ({ ...p, second_approver_id: e.target.value || null }))}
                >
                  <option value="">None</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>{a.display_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={styles.field}>
                <label style={styles.label}>Finance Notes (shown to approver)</label>
                <textarea
                  style={{
                    ...styles.input,
                    height: 88,
                    resize: 'vertical',
                    lineHeight: 1.55,
                    fontFamily: 'var(--font-display)',
                    fontStyle: form.finance_notes ? 'normal' : 'italic',
                    ...(!isEditable ? styles.inputReadOnly : {}),
                  }}
                  value={form.finance_notes ?? ''}
                  readOnly={!isEditable}
                  disabled={!isEditable}
                  placeholder="A short note for the approver…"
                  onChange={(e) => setForm((p) => ({ ...p, finance_notes: e.target.value || null }))}
                />
              </div>
            </div>
          </Section>

          <Section title="Audit Trail" number="07">
            <AuditTimeline entries={auditLog} />
          </Section>
        </div>
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Send for Approval"
          message="An approval email will be dispatched to the assigned approver. The invoice will become read-only for finance until the decision is returned."
          confirmLabel="Send approval email"
          onConfirm={handleMarkReady}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {showDismissConfirm && (
        <ConfirmDialog
          title="Dismiss Invoice"
          message="This will mark the record as 'Not Applicable' and hide it from the main ledger view. It can still be found using the Dismissed filter. This action can be undone by finance."
          confirmLabel="Dismiss record"
          onConfirm={handleDismiss}
          onCancel={() => setShowDismissConfirm(false)}
        />
      )}
    </div>
  );
}

function Section({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyles.wrap}>
      <div style={sectionStyles.header}>
        <span style={sectionStyles.number}>{number}</span>
        <h3 style={sectionStyles.title}>{title}</h3>
        <span style={sectionStyles.rule} />
      </div>
      <div>{children}</div>
    </section>
  );
}

const sectionStyles: Record<string, React.CSSProperties> = {
  wrap: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '22px 24px',
    marginBottom: 14,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  number: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.12em',
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
  },
  rule: {
    flex: 1,
    height: 1,
    background: 'var(--line)',
  },
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  masthead: {
    padding: '4px 0 0',
  },
  back: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--ink-muted)',
    fontSize: 12,
    fontWeight: 500,
    marginBottom: 18,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    transition: 'color 0.15s var(--ease)',
  },
  backArrow: { color: 'var(--accent)' },
  mastheadMain: {
    paddingBottom: 20,
    borderBottom: '1px solid var(--line)',
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 32,
    flexWrap: 'wrap',
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
  kickerRule: {
    width: 28,
    height: 1,
    background: 'var(--accent)',
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(32px, 3.2vw, 42px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.05,
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  subtitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  subRef: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    color: 'var(--ink-muted)',
  },
  subSep: { color: 'var(--ink-faint)' },
  headerActions: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  dismissBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid rgba(244, 63, 94, 0.3)',
    color: 'var(--danger)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
  },
  saveBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid var(--line-strong)',
    color: 'var(--ink-soft)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
  },
  approvalBtn: {
    padding: '10px 20px',
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
  approvalArrow: { fontSize: 14 },
  approvalBtnDisabled: {
    background: 'var(--line-strong)',
    borderColor: 'var(--line-strong)',
    color: 'var(--ink-faint)',
    cursor: 'not-allowed',
  },
  approvalBtnWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
  },
  approvalHint: {
    fontSize: 10.5,
    color: 'var(--warning)',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
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
  },
  noPdfMark: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 48,
    color: 'var(--ink-faint)',
    opacity: 0.45,
  },
  noPdfText: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    color: 'var(--ink-muted)',
    fontSize: 14,
  },
  formPanel: {
    minWidth: 0,
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px 20px' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  input: {
    padding: '9px 12px',
    border: '1px solid var(--line-strong)',
    borderRadius: 7,
    fontSize: 13.5,
    background: 'var(--paper)',
    color: 'var(--ink)',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s var(--ease), background 0.15s var(--ease)',
  },
  inputReadOnly: {
    background: 'transparent',
    color: 'var(--ink-soft)',
    cursor: 'default',
  },
  required: { color: 'var(--danger)', fontFamily: 'var(--font-display)', fontStyle: 'italic' },
  fieldWarn: {
    fontSize: 10.5,
    color: 'var(--danger)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontWeight: 600,
    marginTop: 2,
  },
  charCount: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    textAlign: 'right',
  },
  errorBanner: {
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
    background: 'var(--success-soft)',
    border: '1px solid rgba(58, 106, 63, 0.25)',
    color: 'var(--success)',
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
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
  },
  rejectedBanner: {
    background: 'rgba(160,49,53,0.06)',
    border: '1.5px solid rgba(160,49,53,0.3)',
    borderRadius: 10,
    padding: '14px 18px',
    marginBottom: 16,
  },
  rejectedHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
    flexWrap: 'wrap' as const,
  },
  rejectedLabel: {
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--danger)',
    flexShrink: 0,
  },
  rejectedHint: {
    fontSize: 13,
    color: 'var(--ink-muted)',
  },
  rejectedReason: {
    marginTop: 10,
    fontSize: 13,
    color: 'var(--ink-soft)',
    background: 'rgba(160,49,53,0.04)',
    border: '1px solid rgba(160,49,53,0.15)',
    borderRadius: 6,
    padding: '8px 12px',
    lineHeight: 1.5,
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
