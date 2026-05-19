import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// ── Types ──────────────────────────────────────────────────────────────────────

export type InvoiceStatus =
  | 'pending_finance_review'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'approved_ready_export'
  | 'exported';

export type UserRole = 'finance' | 'approver' | 'auditor' | 'admin' | 'staff';
export type AuditAction =
  | 'created' | 'ocr_completed' | 'finance_edited' | 'status_changed'
  | 'approval_sent' | 'approved' | 'rejected' | 'forwarded'
  | 'reminder_sent' | 'csv_generated' | 'exported';

export interface Profile {
  id: string;
  azure_oid: string | null;
  email: string;
  display_name: string;
  role: UserRole;
  user_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Approver {
  id: string;
  azure_oid: string;
  email: string;
  display_name: string;
  department: string | null;
  is_active: boolean;
  synced_at: string;
}

export interface InvoiceFile {
  id: string;
  storage_path: string;
  bucket_name: string;
  original_name: string;
  mime_type: string;
  file_size_bytes: number | null;
  email_from: string | null;
  email_date: string | null;
  email_subject: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  invoice_file_id: string | null;
  status: InvoiceStatus;
  account_number: string | null;
  supplier_name: string | null;
  supplier_ref: string | null;
  supplier_ref_code: string | null;
  transaction_reference: string | null;
  second_reference: string | null;
  unique_reference_number: string | null;
  transaction_date: string | null;
  posting_date: string | null;
  due_date: string | null;
  description: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  source: number;
  sys_trader_tran_type: number;
  query_code: string | null;
  sys_trader_generation_reason_type: string | null;
  document_to_base_currency_rate: number;
  document_to_account_currency_rate: number;
  assigned_approver_id: string | null;
  second_approver_id: string | null;
  finance_notes: string | null;
  finance_user_id: string | null;
  approved_by_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  forwarded_to_id: string | null;
  forwarded_reason: string | null;
  approval_sent_at: string | null;
  approver_comments: string | null;
  exported_at: string | null;
  exported_by_id: string | null;
  csv_export_id: string | null;
  created_at: string;
  created_by_id: string | null;
  updated_at: string;
  updated_by_id: string | null;
}

export interface NominalLine {
  id: string;
  purchase_order_id: string;
  line_number: 1 | 2;
  transaction_value: number | null;
  nominal_account_number: string | null;
  nominal_cost_centre: string | null;
  nominal_department: string | null;
  transaction_analysis_code: string | null;
  nominal_analysis_narrative: string | null;
  created_at: string;
  updated_at: string;
}

export interface VatLine {
  id: string;
  purchase_order_id: string;
  line_number: 1 | 2;
  tax_rate: number | null;
  goods_value_before_discount: number | null;
  tax_on_goods_value: number | null;
  vat_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface OcrExtraction {
  id: string;
  purchase_order_id: string;
  invoice_file_id: string;
  gemini_model: string;
  raw_response: unknown;
  extracted_fields: Record<string, unknown>;
  confidence_scores: unknown;
  processing_ms: number | null;
  created_at: string;
}

// ── Expense types ─────────────────────────────────────────────────────────────

export type ExpenseCategory =
  | 'travel_accommodation'
  | 'travel_meals'
  | 'travel_transport'
  | 'office_supplies'
  | 'software'
  | 'training'
  | 'client_entertainment'
  | 'other';

export type ExpenseStatus =
  | 'pending_finance_review'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'exported';

export interface ExpenseFile {
  id: string;
  storage_path: string;
  bucket_name: string;
  original_name: string;
  mime_type: string;
  file_size_bytes: number | null;
  email_from: string | null;
  email_date: string | null;
  email_subject: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  expense_file_id: string | null;
  status: ExpenseStatus;
  employee_email: string;
  employee_name: string | null;
  category: ExpenseCategory;
  description: string | null;
  receipt_date: string | null;
  merchant_name: string | null;
  amount: number;
  currency: string;
  assigned_approver_id: string | null;
  approved_by_id: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  forwarded_to_id: string | null;
  forwarded_reason: string | null;
  approval_sent_at: string | null;
  approver_comments: string | null;
  exported_at: string | null;
  exported_by_id: string | null;
  csv_export_id: string | null;
  gl_code: string | null;
  cost_centre: string | null;
  department: string | null;
  finance_notes: string | null;
  finance_user_id: string | null;
  created_at: string;
  created_by_id: string | null;
  updated_at: string;
  updated_by_id: string | null;
}

export interface ExpenseOcrExtraction {
  id: string;
  expense_id: string;
  expense_file_id: string;
  gemini_model: string;
  raw_response: unknown;
  extracted_fields: Record<string, unknown>;
  confidence_scores: unknown;
  processing_ms: number | null;
  created_at: string;
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  travel_accommodation: '🏨 Accommodation',
  travel_meals:        '🍽️ Meals',
  travel_transport:    '🚗 Transport',
  office_supplies:     '📎 Office Supplies',
  software:            '💻 Software',
  training:            '📚 Training',
  client_entertainment:'🤝 Client Entertainment',
  other:               '📋 Other',
};

export interface AuditLogEntry {
  id: string;
  purchase_order_id: string | null;
  action: AuditAction;
  actor_id: string | null;
  actor_email: string | null;
  actor_display: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}
