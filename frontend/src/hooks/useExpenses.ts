import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Expense, ExpenseStatus } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function callFunction(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `${name} failed`);
  return json;
}

// ── Fetch list ────────────────────────────────────────────────────────────────

export function useExpenses(status?: ExpenseStatus) {
  return useQuery({
    queryKey: ['expenses', status ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select(`
          *,
          expense_files(*),
          approver:approvers!expenses_assigned_approver_id_fkey(id, email, display_name, department)
        `)
        .order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data as (Expense & { expense_files: unknown; approver: unknown })[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ── Fetch single ──────────────────────────────────────────────────────────────

export function useExpense(id: string, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ['expense', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          expense_files(*),
          approver:approvers!expenses_assigned_approver_id_fkey(id, email, display_name, department),
          ocr:expense_ocr_extractions(*)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

// ── Save draft ────────────────────────────────────────────────────────────────

export function useSaveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Expense> }) => {
      const { error } = await supabase.from('expenses').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['expense', id] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

// ── Upload receipt + create expense ──────────────────────────────────────────

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      employeeEmail,
      employeeName,
      category,
      company,
      userId,
    }: {
      file: File;
      employeeEmail: string;
      employeeName: string;
      category: string;
      company: string;
      userId: string;
    }) => {
      // 1. Upload file to storage
      const ext = file.name.split('.').pop() ?? 'jpg';
      const tmpId = crypto.randomUUID();
      const storagePath = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${tmpId}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('expenses')
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);

      // 2. Insert expense_files record
      const { data: fileRec, error: fileErr } = await supabase
        .from('expense_files')
        .insert({
          storage_path: storagePath,
          bucket_name: 'expenses',
          original_name: file.name,
          mime_type: file.type,
          file_size_bytes: file.size,
          uploaded_by: userId,
        })
        .select()
        .single();
      if (fileErr || !fileRec) throw new Error('File record failed: ' + fileErr?.message);

      // 3. Insert draft expense
      const { data: expense, error: expErr } = await supabase
        .from('expenses')
        .insert({
          expense_file_id: fileRec.id,
          status: 'pending_finance_review',
          employee_email: employeeEmail,
          employee_name: employeeName,
          category,
          company,
          amount: 0,
          currency: 'GBP',
          created_by_id: userId,
        })
        .select()
        .single();
      if (expErr || !expense) throw new Error('Expense record failed: ' + expErr?.message);

      // 4. Trigger OCR
      try {
        await callFunction('ocr-expenses', {
          expense_id: expense.id,
          expense_file_id: fileRec.id,
        });
      } catch (ocrErr) {
        console.warn('OCR failed (non-fatal):', ocrErr);
      }

      return expense;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

// ── Send for approval ─────────────────────────────────────────────────────────

export function useSendExpenseApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ expense_id, resend = false }: { expense_id: string; resend?: boolean }) => {
      // Update status first
      if (!resend) {
        const { error } = await supabase
          .from('expenses')
          .update({ status: 'pending_approval' })
          .eq('id', expense_id);
        if (error) throw error;
      }
      // Send email
      return callFunction('send-expense-approval', { expense_id, resend });
    },
    onSuccess: (_data, { expense_id }) => {
      qc.invalidateQueries({ queryKey: ['expense', expense_id] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

// ── Process approval decision ─────────────────────────────────────────────────

export function useProcessExpenseApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      expense_id: string;
      action: 'approve' | 'reject' | 'forward';
      comments?: string;
      reject_reason?: string;
      forward_to_approver_id?: string;
      forward_reason?: string;
      approver_email?: string;
    }) => callFunction('process-expense-approval', payload),
    onSuccess: (_data, { expense_id }) => {
      qc.invalidateQueries({ queryKey: ['expense', expense_id] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

// ── Export CSV ────────────────────────────────────────────────────────────────

export function useGenerateExpenseCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ expense_ids, exported_by_id }: { expense_ids: string[]; exported_by_id: string }) =>
      callFunction('generate-expense-csv', { expense_ids, exported_by_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}
