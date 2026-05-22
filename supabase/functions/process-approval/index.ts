/**
 * process-approval: Records an approver's decision (approve/reject/forward)
 * on a purchase order. Called from the frontend ApproverView page.
 *
 * Self-contained — no _shared imports (MCP bundler limitation).
 * POST body: { purchase_order_id, action: 'approve'|'reject'|'forward', comment?, forward_to_approver_id? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

// ── Supabase admin client ─────────────────────────────────────────────────────
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { user: null, error: new Error('Missing Authorization header') };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return { user: data?.user ?? null, error };
}

// ── MS Graph helpers ──────────────────────────────────────────────────────────
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.token;
  }
  const tenantId = Deno.env.get('AZURE_TENANT_ID')!;
  const clientId = Deno.env.get('AZURE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET')!;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', body: params },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph token fetch failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.token;
}

async function sendMail(from: string, payload: unknown): Promise<void> {
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendMail failed: ${res.status} ${body}`);
  }
}

// ── Finance notification email ────────────────────────────────────────────────
async function notifyFinance(
  po: Record<string, unknown>,
  decision: 'approved' | 'rejected',
  approverName: string,
  comment?: string,
) {
  const financeMailbox = Deno.env.get('FINANCE_MAILBOX')!;
  const frontendUrl = Deno.env.get('FRONTEND_URL') ?? 'https://purple-stone-016c8bb03.6.azurestaticapps.net';

  const isApproved = decision === 'approved';
  const statusLabel = isApproved ? 'Approved ✓' : 'Rejected ✗';
  const headerColor = isApproved ? '#065f46' : '#7f1d1d';
  const headerBg = isApproved ? '#d1fae5' : '#fee2e2';
  const badgeColor = isApproved ? '#10b981' : '#ef4444';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
        <tr>
          <td style="background:${headerBg};border-bottom:3px solid ${badgeColor};padding:20px 28px;">
            <p style="margin:0;font-size:11px;font-weight:700;color:${headerColor};letter-spacing:0.14em;text-transform:uppercase;">SOTARA · FINANCE NOTIFICATION</p>
            <h2 style="margin:6px 0 0;font-size:20px;color:${headerColor};">Invoice ${statusLabel}</h2>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">
              Invoice <strong>${String(po.transaction_reference ?? po.id)}</strong> from <strong>${String(po.supplier_name ?? 'Unknown')}</strong> has been <strong>${decision}</strong> by ${approverName}.
            </p>
            ${comment ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
              <p style="margin:0;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Comment</p>
              <p style="margin:0;font-size:14px;color:#374151;font-style:italic;">"${comment}"</p>
            </div>` : ''}
            <a href="${frontendUrl}/invoices/${String(po.id)}"
               style="display:inline-block;background:#0a1628;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;margin-top:8px;">
              View Invoice →
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:12px 28px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">Sotara Finance · Automated Notification</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await sendMail(financeMailbox, {
    message: {
      subject: `Invoice ${statusLabel}: ${String(po.supplier_name ?? '')} — ${String(po.transaction_reference ?? po.id)}`,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: financeMailbox } }],
    },
    saveToSentItems: false,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
type ApprovalAction = 'approve' | 'reject' | 'forward';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { user, error: authError } = await getUserFromRequest(req);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: {
    purchase_order_id: string;
    action: ApprovalAction;
    comment?: string;
    forward_to_approver_id?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { purchase_order_id, action, comment, forward_to_approver_id } = payload;

  if (!purchase_order_id || !action) {
    return new Response(JSON.stringify({ error: 'purchase_order_id and action required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (action === 'reject' && !comment) {
    return new Response(JSON.stringify({ error: 'comment is required for rejection' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (action === 'forward' && !forward_to_approver_id) {
    return new Response(JSON.stringify({ error: 'forward_to_approver_id is required for forwarding' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch PO
    const { data: po, error: poError } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('id', purchase_order_id)
      .single();

    if (poError || !po) throw new Error('PO not found');

    if (po.status !== 'pending_approval') {
      throw new Error(`PO is not pending approval (current status: ${po.status})`);
    }

    // Verify the acting user is the assigned approver
    // Look them up by email in the approvers table
    const { data: approverRow } = await supabaseAdmin
      .from('approvers')
      .select('id')
      .ilike('email', user.email!)
      .single();

    const isAssignedApprover =
      approverRow &&
      (po.assigned_approver_id === approverRow.id || po.second_approver_id === approverRow.id);

    if (!isAssignedApprover) {
      // Also allow finance/admin profiles to process approvals (useful for testing)
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (!profileRow || !['admin', 'finance'].includes(profileRow.role)) {
        return new Response(JSON.stringify({ error: 'You are not the assigned approver for this invoice' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fetch actor display info
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, display_name')
      .eq('id', user.id)
      .single();

    const actorDisplay = profile?.display_name ?? user.email ?? 'Unknown';
    const actorEmail = profile?.email ?? user.email ?? '';
    const now = new Date().toISOString();

    if (action === 'approve') {
      await supabaseAdmin.from('purchase_orders').update({
        status: 'approved',
        approved_by_id: user.id,
        approved_at: now,
        approver_comments: comment ?? null,
        updated_by_id: user.id,
      }).eq('id', purchase_order_id);

      await supabaseAdmin.from('audit_log').insert({
        purchase_order_id,
        action: 'approved',
        actor_id: user.id,
        actor_email: actorEmail,
        actor_display: actorDisplay,
        new_values: { status: 'approved', comment: comment ?? null, approved_at: now },
      });

      // Fire-and-forget finance notification — don't let email failure break the approval
      notifyFinance(po, 'approved', actorDisplay, comment).catch((e) => {
        console.warn('[process-approval] Finance notification failed (approve):', e);
      });

    } else if (action === 'reject') {
      await supabaseAdmin.from('purchase_orders').update({
        status: 'rejected',
        rejected_reason: comment,
        updated_by_id: user.id,
      }).eq('id', purchase_order_id);

      await supabaseAdmin.from('audit_log').insert({
        purchase_order_id,
        action: 'rejected',
        actor_id: user.id,
        actor_email: actorEmail,
        actor_display: actorDisplay,
        new_values: { status: 'rejected', rejected_reason: comment },
      });

      notifyFinance(po, 'rejected', actorDisplay, comment).catch((e) => {
        console.warn('[process-approval] Finance notification failed (reject):', e);
      });

    } else if (action === 'forward') {
      const { data: newApprover } = await supabaseAdmin
        .from('approvers')
        .select('email, display_name')
        .eq('id', forward_to_approver_id)
        .single();

      if (!newApprover) throw new Error('Forward-to approver not found');

      await supabaseAdmin.from('purchase_orders').update({
        assigned_approver_id: forward_to_approver_id,
        forwarded_to_id: forward_to_approver_id,
        forwarded_reason: comment,
        approval_sent_at: null,
        updated_by_id: user.id,
      }).eq('id', purchase_order_id);

      await supabaseAdmin.from('audit_log').insert({
        purchase_order_id,
        action: 'forwarded',
        actor_id: user.id,
        actor_email: actorEmail,
        actor_display: actorDisplay,
        old_values: { assigned_approver_id: po.assigned_approver_id },
        new_values: {
          assigned_approver_id: forward_to_approver_id,
          forwarded_reason: comment ?? null,
          forwarded_to: newApprover.email,
        },
      });

      // Retrigger approval email to the new approver via internal function call
      // Pass the service-role key so the send-approval function can authenticate
      fetch(`${supabaseUrl}/functions/v1/send-approval`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purchase_order_id }),
      }).catch((e) => {
        console.warn('[process-approval] Re-trigger send-approval failed:', e);
      });
    }

    // Return updated PO
    const { data: updatedPo } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('id', purchase_order_id)
      .single();

    return new Response(JSON.stringify({ success: true, purchase_order: updatedPo }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[process-approval] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
