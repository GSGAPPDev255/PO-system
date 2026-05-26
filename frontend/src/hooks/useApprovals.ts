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

export interface MarkReadyPayload {
  poId: string;
  // When to send the approval email:
  //  - undefined / null  → send immediately (calls send-approval inline)
  //  - ISO timestamp     → queue for the dispatcher cron at that time
  scheduledAt?: string | null;
}

export function useMarkReadyForApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: MarkReadyPayload | string) => {
      // Backwards compat — older callers passed just the poId as a string.
      const { poId, scheduledAt } =
        typeof payload === 'string' ? { poId: payload, scheduledAt: null } : payload;

      const { data: { user } } = await supabase.auth.getUser();
      const isScheduled = !!scheduledAt;

      // Flip status to pending_approval; for scheduled sends also stamp the
      // scheduled_send_at — the dispatcher cron picks them up at the right time.
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'pending_approval',
          updated_by_id: user?.id,
          scheduled_send_at: scheduledAt ?? null,
        })
        .eq('id', poId)
        .select()
        .single();
      if (error) throw error;

      // Scheduled sends: just record an audit entry. The actual email goes out
      // when dispatch-scheduled-approvals fires at the scheduled time.
      if (isScheduled) {
        await supabase.from('audit_log').insert({
          purchase_order_id: poId,
          action: 'status_changed',
          actor_id: user?.id,
          metadata: {
            new_status: 'pending_approval',
            scheduled_send_at: scheduledAt,
            kind: 'scheduled_approval',
          },
        });
        return data;
      }

      // Immediate send. If this fails we must roll the status back — otherwise
      // the PO is stuck "pending approval" with no email ever sent.
      const { error: fnError, data: fnData } = await supabase.functions.invoke(
        'send-approval',
        { body: { purchase_order_id: poId } },
      );
      if (fnError) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'pending_finance_review', updated_by_id: user?.id, scheduled_send_at: null })
          .eq('id', poId);

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
      if (fnData && typeof fnData === 'object' && 'error' in fnData && fnData.error) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'pending_finance_review', updated_by_id: user?.id, scheduled_send_at: null })
          .eq('id', poId);
        throw new Error(`Failed to send approval email: ${String(fnData.error)}`);
      }

      return data;
    },
    onSuccess: (_, payload) => {
      const poId = typeof payload === 'string' ? payload : payload.poId;
      qc.invalidateQueries({ queryKey: ['invoice', poId] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['audit', poId] });
    },
  });
}

// Cancel a scheduled send — reverts back to pending_finance_review so the
// invoice re-appears in the review queue and finance can amend it.
export function useCancelScheduledSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (poId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'pending_finance_review',
          scheduled_send_at: null,
          updated_by_id: user?.id,
        })
        .eq('id', poId)
        .select()
        .single();
      if (error) throw error;

      await supabase.from('audit_log').insert({
        purchase_order_id: poId,
        action: 'status_changed',
        actor_id: user?.id,
        metadata: { new_status: 'pending_finance_review', kind: 'scheduled_send_cancelled' },
      });
      return data;
    },
    onSuccess: (_, poId) => {
      qc.invalidateQueries({ queryKey: ['invoice', poId] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['audit', poId] });
    },
  });
}

// Send a queued/scheduled PO now (bypasses the scheduled time, status already
// pending_approval — just clear scheduled_send_at and fire send-approval).
export function useSendScheduledNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (poId: string) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { error: clearErr } = await supabase
        .from('purchase_orders')
        .update({ scheduled_send_at: null, updated_by_id: user?.id })
        .eq('id', poId);
      if (clearErr) throw clearErr;

      const { error: fnError } = await supabase.functions.invoke(
        'send-approval',
        { body: { purchase_order_id: poId } },
      );
      if (fnError) {
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
      return true;
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
