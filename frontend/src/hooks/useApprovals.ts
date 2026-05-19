import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AuditLogEntry } from '../lib/supabase';

export function useAuditLog(poId: string) {
  return useQuery({
    queryKey: ['audit', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('purchase_order_id', poId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as AuditLogEntry[];
    },
    enabled: !!poId,
  });
}

export function useApprovers(company?: string | null) {
  return useQuery({
    queryKey: ['approvers', company ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('approvers')
        .select('*')
        .eq('is_active', true)
        .order('display_name');

      // If a company is specified, return group-wide approvers (company IS NULL)
      // plus approvers specific to that company
      if (company) {
        query = supabase
          .from('approvers')
          .select('*')
          .eq('is_active', true)
          .or(`company.is.null,company.eq.${company}`)
          .order('display_name');
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useMarkReadyForApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (poId: string) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Flip status first so the send-approval function (which requires
      // status='pending_approval') accepts the PO.
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: 'pending_approval', updated_by_id: user?.id })
        .eq('id', poId)
        .select()
        .single();
      if (error) throw error;

      // Trigger send-approval edge function. If this fails we must roll the
      // status back — otherwise the PO is stuck "pending approval" with no
      // email ever sent and no way to resend from the UI.
      const { error: fnError, data: fnData } = await supabase.functions.invoke(
        'send-approval',
        { body: { purchase_order_id: poId } },
      );
      if (fnError) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'pending_finance_review', updated_by_id: user?.id })
          .eq('id', poId);

        // FunctionsHttpError swallows the body — surface a useful message.
        let detail = fnError.message || 'Edge function error';
        try {
          const ctx = (fnError as { context?: { json?: () => Promise<unknown> } }).context;
          if (ctx?.json) {
            const body = await ctx.json() as { error?: string };
            if (body?.error) detail = body.error;
          }
        } catch { /* ignore */ }
        throw new Error(`Failed to send approval email: ${detail}`);
      }
      // Some edge runtimes return { error } in the data payload rather than fnError
      if (fnData && typeof fnData === 'object' && 'error' in fnData && fnData.error) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'pending_finance_review', updated_by_id: user?.id })
          .eq('id', poId);
        throw new Error(`Failed to send approval email: ${String(fnData.error)}`);
      }

      return data;
    },
    onSuccess: (_, poId) => {
      qc.invalidateQueries({ queryKey: ['invoice', poId] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['audit', poId] });
    },
  });
}

export function useSubmitApprovalDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      purchase_order_id: string;
      action: 'approve' | 'reject' | 'forward';
      comment?: string;
      forward_to_approver_id?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('process-approval', {
        body: payload,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['invoice', vars.purchase_order_id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['audit', vars.purchase_order_id] });
    },
  });
}
