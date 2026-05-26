/**
 * dispatch-scheduled-approvals: Cron-fired dispatcher for scheduled approval
 * emails (Option D hybrid send model).
 *
 * Selects POs whose `scheduled_send_at <= now()` and `approval_sent_at IS NULL`
 * and status='pending_approval', then sends each approval email via MS Graph.
 *
 * Self-contained — no _shared imports (MCP bundler limitation). The email
 * sending and template logic is duplicated from send-approval. If you change
 * one, change both.
 *
 * Schedule: every 5 minutes via Supabase scheduled functions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

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

// ── Email template (mirrors send-approval/index.ts) ──────────────────────────
function buildApprovalEmail(opts: {
  approverName: string;
  supplierName: string;
  invoiceRef: string;
  grossAmount: string;
  transactionDate: string;
  financeNotes: string;
  approveUrl: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0a1628 0%,#1e3a5f 100%);padding:28px 36px;">
            <p style="margin:0;color:#00b4d8;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">SOTARA · FINANCE</p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.02em;">Invoice Approval Required</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">Dear <strong>${opts.approverName}</strong>,</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
              An invoice has been reviewed by the finance team and requires your approval before it can be processed for payment.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;">
                <td style="padding:12px 16px;font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;border-bottom:1px solid #e5e7eb;" colspan="2">INVOICE DETAILS</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;width:40%;">Supplier</td>
                <td style="padding:12px 16px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;font-weight:600;">${opts.supplierName}</td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;">Invoice Reference</td>
                <td style="padding:12px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;font-family:monospace;">${opts.invoiceRef}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6;">Invoice Date</td>
                <td style="padding:12px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">${opts.transactionDate}</td>
              </tr>
              <tr style="background:#eff6ff;">
                <td style="padding:14px 16px;font-size:13px;font-weight:700;color:#1d4ed8;">Total Amount</td>
                <td style="padding:14px 16px;font-size:20px;font-weight:700;color:#1d4ed8;">${opts.grossAmount}</td>
              </tr>
              ${opts.financeNotes ? `<tr>
                <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#6b7280;border-top:1px solid #f3f4f6;">Finance Notes</td>
                <td style="padding:12px 16px;font-size:13px;color:#374151;font-style:italic;">${opts.financeNotes}</td>
              </tr>` : ''}
            </table>
            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-bottom:28px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                <strong>Note:</strong> By approving this invoice, you are authorising the spend. The finance team has already validated all invoice data for accuracy.
              </p>
            </div>
            <div style="text-align:center;margin:32px 0;">
              <a href="${opts.approveUrl}"
                 style="display:inline-block;background:#0a1628;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.01em;border:2px solid #00b4d8;">
                Review &amp; Respond to Invoice →
              </a>
            </div>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">
              This link requires your Microsoft 365 login.<br>
              If you were not expecting this request, please contact the finance team.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 36px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">Sotara Finance · Automated Invoice Approval System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

interface PORow {
  id: string;
  status: string;
  supplier_name: string | null;
  transaction_reference: string | null;
  transaction_date: string | null;
  gross_amount: number | null;
  finance_notes: string | null;
  scheduled_send_at: string | null;
  approval_sent_at: string | null;
  approver:        { id: string; email: string; display_name: string } | null;
  second_approver: { id: string; email: string; display_name: string } | null;
}

async function dispatchOne(po: PORow, financeMailbox: string, frontendUrl: string): Promise<void> {
  if (!po.approver) throw new Error('No approver assigned');

  const approveUrl = `${frontendUrl}/approve/${po.id}`;
  const grossFormatted = po.gross_amount != null
    ? `£${Number(po.gross_amount).toFixed(2)}`
    : 'Not set';

  const emailHtml = buildApprovalEmail({
    approverName: po.approver.display_name,
    supplierName: po.supplier_name ?? 'Unknown Supplier',
    invoiceRef: po.transaction_reference ?? 'N/A',
    grossAmount: grossFormatted,
    transactionDate: po.transaction_date ?? 'N/A',
    financeNotes: po.finance_notes ?? '',
    approveUrl,
  });

  const toRecipients: { emailAddress: { address: string; name: string } }[] = [
    { emailAddress: { address: po.approver.email, name: po.approver.display_name } },
  ];
  if (po.second_approver) {
    toRecipients.push({
      emailAddress: { address: po.second_approver.email, name: po.second_approver.display_name },
    });
  }

  await sendMail(financeMailbox, {
    message: {
      subject: `Invoice Approval Required: ${po.supplier_name ?? ''} — ${po.transaction_reference ?? po.id}`,
      body: { contentType: 'HTML', content: emailHtml },
      toRecipients,
    },
    saveToSentItems: true,
  });

  // Mark sent + clear schedule
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('purchase_orders')
    .update({ approval_sent_at: now, scheduled_send_at: null })
    .eq('id', po.id);

  await supabaseAdmin.from('audit_log').insert({
    purchase_order_id: po.id,
    action: 'approval_sent',
    actor_email: 'system@dispatch-scheduled-approvals',
    actor_display: 'Scheduled Dispatch (System)',
    new_values: {
      sent_to: toRecipients.map((r) => r.emailAddress.address),
      approval_sent_at: now,
      via: 'scheduled_dispatcher',
    },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const frontendUrl = Deno.env.get('FRONTEND_URL') ?? 'https://purple-stone-016c8bb03.6.azurestaticapps.net';
  const financeMailbox = Deno.env.get('FINANCE_MAILBOX');
  if (!financeMailbox) {
    return new Response(JSON.stringify({ error: 'FINANCE_MAILBOX not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Fetch all POs that are due to be dispatched
  const { data: due, error } = await supabaseAdmin
    .from('purchase_orders')
    .select(`
      id, status, supplier_name, transaction_reference, transaction_date,
      gross_amount, finance_notes, scheduled_send_at, approval_sent_at,
      approver:approvers!assigned_approver_id (id, email, display_name),
      second_approver:approvers!second_approver_id (id, email, display_name)
    `)
    .eq('status', 'pending_approval')
    .is('approval_sent_at', null)
    .not('scheduled_send_at', 'is', null)
    .lte('scheduled_send_at', new Date().toISOString())
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results = { checked: due?.length ?? 0, sent: 0, failed: 0, errors: [] as string[] };
  for (const po of (due ?? []) as unknown as PORow[]) {
    try {
      await dispatchOne(po, financeMailbox, frontendUrl);
      results.sent++;
    } catch (err) {
      results.failed++;
      const msg = `[${po.id}] ${(err as Error).message}`;
      results.errors.push(msg);
      console.error('[dispatch-scheduled-approvals]', msg);
    }
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
