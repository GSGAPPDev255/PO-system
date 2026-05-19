import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PurchaseOrder, InvoiceStatus, NominalLine, VatLine, OcrExtraction } from '../lib/supabase';

export function useInvoices(statusFilter?: InvoiceStatus | InvoiceStatus[]) {
  return useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select(`
          *,
          invoice_file:invoice_files!invoice_file_id (id, original_name, storage_path, mime_type, email_from, email_date),
          approver:approvers!assigned_approver_id (id, email, display_name, department),
          second_approver:approvers!second_approver_id (id, email, display_name)
        `)
        .order('created_at', { ascending: false });

      if (statusFilter) {
        if (Array.isArray(statusFilter)) {
          q = q.in('status', statusFilter);
        } else {
          q = q.eq('status', statusFilter);
        }
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as (PurchaseOrder & { invoice_file?: unknown; approver?: unknown; second_approver?: unknown })[];
    },
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          invoice_file:invoice_files!invoice_file_id (id, original_name, storage_path, mime_type, email_from, email_date),
          approver:approvers!assigned_approver_id (id, email, display_name, department),
          second_approver:approvers!second_approver_id (id, email, display_name)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useNominalLines(poId: string) {
  return useQuery({
    queryKey: ['nominal-lines', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nominal_lines')
        .select('*')
        .eq('purchase_order_id', poId)
        .order('line_number');
      if (error) throw error;
      return data as NominalLine[];
    },
    enabled: !!poId,
  });
}

export function useVatLines(poId: string) {
  return useQuery({
    queryKey: ['vat-lines', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vat_lines')
        .select('*')
        .eq('purchase_order_id', poId)
        .order('line_number');
      if (error) throw error;
      return data as VatLine[];
    },
    enabled: !!poId,
  });
}

export function useOcrExtraction(poId: string) {
  return useQuery({
    queryKey: ['ocr', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ocr_extractions')
        .select('*')
        .eq('purchase_order_id', poId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data as OcrExtraction | null;
    },
    enabled: !!poId,
  });
}

// Explicit whitelist of columns that finance is allowed to update on a PO.
// Using a whitelist (instead of "strip known joins") bulletproofs against any
// foreign field leaking into the payload — PostgREST rejects the whole update
// with "Could not find the 'X' column" if a single unknown key is present.
const UPDATABLE_PO_COLUMNS = [
  'status',
  'account_number', 'supplier_name', 'supplier_ref', 'supplier_ref_code',
  'transaction_reference', 'second_reference', 'unique_reference_number',
  'transaction_date', 'posting_date', 'due_date',
  'description',
  'net_amount', 'vat_amount', 'gross_amount',
  'source', 'sys_trader_tran_type', 'query_code', 'sys_trader_generation_reason_type',
  'document_to_base_currency_rate', 'document_to_account_currency_rate',
  'assigned_approver_id', 'second_approver_id',
  'finance_notes', 'finance_user_id',
  'approved_by_id', 'approved_at', 'rejected_reason',
  'forwarded_to_id', 'forwarded_reason',
  'approval_sent_at', 'approver_comments',
  'exported_at', 'exported_by_id', 'csv_export_id',
  'updated_by_id',
] as const;

function pickUpdatable(updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UPDATABLE_PO_COLUMNS) {
    if (key in updates) out[key] = updates[key];
  }
  return out;
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<PurchaseOrder>;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const clean = pickUpdatable(updates as Record<string, unknown>);
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ ...clean, updated_by_id: user?.id })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['invoice', vars.id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useUpsertNominalLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (line: Partial<NominalLine> & { purchase_order_id: string; line_number: 1 | 2 }) => {
      const { data, error } = await supabase
        .from('nominal_lines')
        .upsert(line, { onConflict: 'purchase_order_id,line_number' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nominal-lines', data.purchase_order_id] });
    },
  });
}

export function useUpsertVatLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (line: Partial<VatLine> & { purchase_order_id: string; line_number: 1 | 2 }) => {
      const { data, error } = await supabase
        .from('vat_lines')
        .upsert(line, { onConflict: 'purchase_order_id,line_number' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vat-lines', data.purchase_order_id] });
    },
  });
}
