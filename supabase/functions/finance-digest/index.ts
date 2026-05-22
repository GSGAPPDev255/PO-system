/**
 * finance-digest: Sends a daily morning summary email to all active finance
 * and admin users showing what needs action today.
 *
 * Self-contained — no _shared imports (MCP bundler limitation).
 * Triggered by: pg_cron daily at 08:30 UTC (or manual POST with no body).
 *
 * Email sections:
 *  1. Inbox — new invoices awaiting finance review
 *  2. Pending Approval — sent to approvers, not yet decided
 *  3. Approved & Ready — ready to export to Sage
 *  4. Overdue — pending_approval invoices older than 5 days with no decision
 *  5. Quick stats — totals
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
  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return _cachedToken.token;
}

async function sendMail(from: string, payload: unknown): Promise<void> {
  const token = await getGraphToken();
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendMail failed: ${res.status} ${body}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtGBP(n: number | null | undefined): string {
  if (n == null) return '—';
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ── Email template ────────────────────────────────────────────────────────────
type DigestPO = {
  id: string;
  supplier_name: string | null;
  transaction_reference: string | null;
  gross_amount: number | null;
  approval_sent_at: string | null;
  created_at: string;
  approver_display: string | null;
};

type DigestData = {
  pendingReview: DigestPO[];
  pendingApproval: DigestPO[];
  readyToExport: DigestPO[];
  overdue: DigestPO[];
  totalOpenValue: number;
};

function rowsHtml(pos: DigestPO[], frontendUrl: string, showApprover = false): string {
  if (pos.length === 0) return '';
  return pos.map(po => `
    <tr>
      <td style="padding:10px 16px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;font-weight:600;">
        <a href="${frontendUrl}/invoices/${po.id}" style="color:#0a1628;text-decoration:none;">${po.supplier_name ?? 'Unknown'}</a>
      </td>
      <td style="padding:10px 16px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;font-family:monospace;">
        ${po.transaction_reference ?? '—'}
      </td>
      <td style="padding:10px 16px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">
        ${fmtGBP(po.gross_amount)}
      </td>
      ${showApprover ? `<td style="padding:10px 16px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${po.approver_display ?? '—'}</td>` : ''}
      <td style="padding:10px 16px;font-size:12px;color:#9ca3af;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
        ${daysSince(po.created_at)}d ago
      </td>
    </tr>
  `).join('');
}

function sectionHtml(
  title: string,
  count: number,
  accent: string,
  rows: string,
  showApprover = false,
): string {
  if (count === 0) return '';
  const approverHeader = showApprover
    ? '<th style="padding:8px 16px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;background:#f9fafb;">Approver</th>'
    : '';
  return `
    <div style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${accent};flex-shrink:0;"></div>
        <h2 style="margin:0;font-size:14px;font-weight:700;color:#111827;letter-spacing:-0.01em;">${title}</h2>
        <span style="font-size:12px;font-weight:600;color:${accent};background:${accent}18;padding:2px 8px;border-radius:20px;">${count}</span>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 16px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;">Supplier</th>
            <th style="padding:8px 16px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;">Ref</th>
            <th style="padding:8px 16px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;">Gross</th>
            ${approverHeader}
            <th style="padding:8px 16px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase;">Age</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildDigestEmail(recipientName: string, data: DigestData, frontendUrl: string): string {
  const {
    pendingReview, pendingApproval, readyToExport, overdue, totalOpenValue,
  } = data;

  const totalActions = pendingReview.length + readyToExport.length + overdue.length;

  const overdueSection = overdue.length > 0
    ? sectionHtml(
        `⚠ Overdue — No Response (${ordinal(Math.max(...overdue.map(p => daysSince(p.approval_sent_at ?? p.created_at))))} day)`,
        overdue.length,
        '#ef4444',
        rowsHtml(overdue, frontendUrl, true),
        true,
      )
    : '';

  const reviewSection = pendingReview.length > 0
    ? sectionHtml('Inbox — Awaiting Finance Review', pendingReview.length, '#00b4d8', rowsHtml(pendingReview, frontendUrl))
    : '';

  const approvalSection = pendingApproval.length > 0
    ? sectionHtml('With Approvers — Awaiting Decision', pendingApproval.length, '#7b61ff', rowsHtml(pendingApproval, frontendUrl, true), true)
    : '';

  const exportSection = readyToExport.length > 0
    ? sectionHtml('Ready to Export to Sage', readyToExport.length, '#06d6a0', rowsHtml(readyToExport, frontendUrl))
    : '';

  const allQuiet = totalActions === 0 && pendingApproval.length === 0;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a1628 0%,#1e3a5f 100%);padding:24px 36px;">
            <p style="margin:0;color:#00b4d8;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">SOTARA · FINANCE DIGEST</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.02em;">Morning Summary</h1>
            <p style="margin:4px 0 0;color:#93c5fd;font-size:12px;">${todayStr()}</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:24px 36px 0;">
            <p style="margin:0 0 6px;color:#374151;font-size:15px;">Good morning, <strong>${recipientName}</strong>.</p>
            <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
              ${allQuiet
                ? "Everything's up to date — no invoices require action today. 🎉"
                : `Here's your daily invoice briefing. There ${totalActions === 1 ? 'is' : 'are'} <strong>${totalActions} item${totalActions === 1 ? '' : 's'} requiring your attention</strong>.`
              }
            </p>
          </td>
        </tr>

        <!-- Stats strip -->
        <tr>
          <td style="padding:20px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
              <tr>
                ${[
                  { label: 'Awaiting Review', value: String(pendingReview.length), color: '#00b4d8' },
                  { label: 'With Approvers', value: String(pendingApproval.length), color: '#7b61ff' },
                  { label: 'Ready to Export', value: String(readyToExport.length), color: '#06d6a0' },
                  { label: 'Open Value', value: fmtGBP(totalOpenValue), color: '#f59e0b' },
                ].map(s => `
                  <td style="padding:14px 16px;text-align:center;border-right:1px solid #e5e7eb;">
                    <div style="font-size:20px;font-weight:700;color:${s.color};">${s.value}</div>
                    <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.12em;margin-top:3px;">${s.label}</div>
                  </td>
                `).join('')}
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sections -->
        <tr>
          <td style="padding:0 36px 28px;">
            ${overdueSection}
            ${reviewSection}
            ${approvalSection}
            ${exportSection}
            ${allQuiet ? '<p style="text-align:center;color:#9ca3af;font-style:italic;font-size:14px;padding:16px 0;">No outstanding invoices. Have a productive day!</p>' : ''}
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 36px 28px;text-align:center;">
            <a href="${frontendUrl}/dashboard"
               style="display:inline-block;background:#0a1628;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;border:2px solid #00b4d8;">
              Open Finance Dashboard →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 36px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">Sotara Finance · Daily Digest · Automated</p>
            <p style="margin:4px 0 0;font-size:10px;color:#d1d5db;">You receive this because you are a finance or admin user on this system.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const frontendUrl = Deno.env.get('FRONTEND_URL') ?? 'https://purple-stone-016c8bb03.6.azurestaticapps.net';
  const financeMailbox = Deno.env.get('FINANCE_MAILBOX')!;
  const OVERDUE_DAYS = 5;

  try {
    // 1. Gather PO counts by status
    const [reviewRes, approvalRes, exportRes] = await Promise.all([
      supabaseAdmin
        .from('purchase_orders')
        .select('id, supplier_name, transaction_reference, gross_amount, created_at')
        .eq('status', 'pending_finance_review')
        .order('created_at', { ascending: true }),

      supabaseAdmin
        .from('purchase_orders')
        .select('id, supplier_name, transaction_reference, gross_amount, approval_sent_at, created_at, approver:approvers!assigned_approver_id(display_name)')
        .eq('status', 'pending_approval')
        .order('approval_sent_at', { ascending: true }),

      supabaseAdmin
        .from('purchase_orders')
        .select('id, supplier_name, transaction_reference, gross_amount, created_at')
        .eq('status', 'approved_ready_export')
        .order('created_at', { ascending: true }),
    ]);

    const pendingReview = (reviewRes.data ?? []) as DigestPO[];
    const pendingApproval = ((approvalRes.data ?? []) as unknown[]).map((po) => {
      const p = po as Record<string, unknown>;
      const approver = p.approver as { display_name?: string } | null;
      return {
        id: p.id,
        supplier_name: p.supplier_name,
        transaction_reference: p.transaction_reference,
        gross_amount: p.gross_amount,
        approval_sent_at: p.approval_sent_at,
        created_at: p.created_at,
        approver_display: approver?.display_name ?? null,
      } as DigestPO;
    });
    const readyToExport = (exportRes.data ?? []) as DigestPO[];

    // Overdue = pending_approval where approval_sent_at older than OVERDUE_DAYS
    const cutoff = new Date(Date.now() - OVERDUE_DAYS * 86_400_000).toISOString();
    const overdue = pendingApproval.filter(
      (p) => p.approval_sent_at && p.approval_sent_at < cutoff,
    );

    // Open value = sum of all active POs (not dismissed/rejected/exported)
    const { data: openData } = await supabaseAdmin
      .from('purchase_orders')
      .select('gross_amount')
      .in('status', ['pending_finance_review', 'pending_approval', 'approved', 'approved_ready_export']);

    const totalOpenValue = ((openData ?? []) as { gross_amount: number | null }[])
      .reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);

    const digestData: DigestData = {
      pendingReview,
      pendingApproval,
      readyToExport,
      overdue,
      totalOpenValue,
    };

    // 2. Get all active finance + admin users
    const { data: financeUsers } = await supabaseAdmin
      .from('profiles')
      .select('email, display_name')
      .in('role', ['finance', 'admin'])
      .eq('is_active', true)
      .eq('is_archived', false);

    if (!financeUsers || financeUsers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active finance users found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Send one email per user (personalised greeting)
    const results: { email: string; ok: boolean; error?: string }[] = [];

    for (const user of financeUsers as { email: string; display_name: string | null }[]) {
      try {
        const firstName = (user.display_name ?? user.email).split(/[\s@]/)[0];
        const html = buildDigestEmail(firstName, digestData, frontendUrl);

        await sendMail(financeMailbox, {
          message: {
            subject: `Finance Digest — ${todayStr()} (${pendingReview.length + readyToExport.length + overdue.length} actions)`,
            body: { contentType: 'HTML', content: html },
            toRecipients: [{ emailAddress: { address: user.email, name: user.display_name ?? user.email } }],
          },
          saveToSentItems: false,
        });

        results.push({ email: user.email, ok: true });
      } catch (err) {
        results.push({ email: user.email, ok: false, error: (err as Error).message });
      }
    }

    // 4. Audit log — single entry for the digest run
    await supabaseAdmin.from('audit_log').insert({
      purchase_order_id: null,
      action: 'digest_sent',
      actor_email: financeMailbox,
      actor_display: 'System (finance-digest)',
      new_values: {
        recipients: results.map((r) => r.email),
        pending_review: pendingReview.length,
        pending_approval: pendingApproval.length,
        ready_to_export: readyToExport.length,
        overdue: overdue.length,
        sent_at: new Date().toISOString(),
      },
    });

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return new Response(
      JSON.stringify({ success: true, sent, failed, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[finance-digest] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
