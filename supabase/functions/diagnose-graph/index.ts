/**
 * diagnose-graph: One-shot diagnostic that tests Azure AD token acquisition
 * and reports exactly what's wrong — secret, tenant ID, client ID, permissions.
 *
 * Returns a detailed breakdown so you know which secret to fix without guessing.
 * Admin-only. Safe to call — read-only, no side effects.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const supabaseUrl      = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin    = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth — admin only
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !userData?.user) return json({ error: 'Unauthorized' }, 401);
  const { data: prof } = await supabaseAdmin.from('profiles').select('role').eq('id', userData.user.id).single();
  if (prof?.role !== 'admin') return json({ error: 'Admin only' }, 403);

  // ── Read secrets and mask them for the response ────────────────────────────
  const tenantId     = Deno.env.get('AZURE_TENANT_ID')     ?? '';
  const clientId     = Deno.env.get('AZURE_CLIENT_ID')     ?? '';
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET') ?? '';
  const financeMailbox = Deno.env.get('FINANCE_MAILBOX')   ?? '';

  const mask = (s: string) =>
    s.length < 6 ? '(empty or too short)' : `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;

  const report: Record<string, unknown> = {
    secrets_present: {
      AZURE_TENANT_ID:     tenantId     ? mask(tenantId)     : '❌ MISSING',
      AZURE_CLIENT_ID:     clientId     ? mask(clientId)     : '❌ MISSING',
      AZURE_CLIENT_SECRET: clientSecret ? mask(clientSecret) : '❌ MISSING',
      FINANCE_MAILBOX:     financeMailbox || '(not set)',
    },
  };

  if (!tenantId || !clientId || !clientSecret) {
    return json({ ...report, conclusion: '❌ One or more required secrets are missing — set them in Supabase Edge Function secrets.' });
  }

  // ── Attempt token acquisition ──────────────────────────────────────────────
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method: 'POST', body: params },
    );
  } catch (err) {
    return json({ ...report, token_step: `❌ Network error reaching login.microsoftonline.com: ${(err as Error).message}` });
  }

  const tokenBody = await tokenRes.text();
  let tokenJson: Record<string, unknown> = {};
  try { tokenJson = JSON.parse(tokenBody); } catch { /* not JSON */ }

  report.token_request = {
    status:     tokenRes.status,
    ok:         tokenRes.ok,
    error_code: tokenJson.error ?? null,
    error_desc: tokenJson.error_description ?? null,
    raw:        tokenRes.ok ? '(token received — not shown)' : tokenBody.slice(0, 600),
  };

  if (!tokenRes.ok) {
    // Decode common Azure error codes into plain English
    const code = String(tokenJson.error ?? '');
    const desc = String(tokenJson.error_description ?? '');
    let hint = '';

    if (desc.includes('AADSTS700016') || desc.includes('was not found'))
      hint = '❌ AZURE_CLIENT_ID is wrong — that app does not exist in this tenant.';
    else if (desc.includes('AADSTS7000215') || desc.includes('invalid client secret'))
      hint = '❌ AZURE_CLIENT_SECRET is wrong or has expired — create a new secret in Azure Portal → App registrations → Certificates & secrets.';
    else if (desc.includes('AADSTS7000222') || desc.includes('expired'))
      hint = '❌ AZURE_CLIENT_SECRET has expired — create a new secret in Azure Portal.';
    else if (desc.includes('AADSTS90002') || desc.includes('Tenant') || tokenRes.status === 400 && desc.includes('tenant'))
      hint = '❌ AZURE_TENANT_ID is wrong — check the Directory (tenant) ID in Azure Portal → Azure Active Directory → Overview.';
    else if (tokenRes.status === 401)
      hint = '❌ 401 from token endpoint — almost always a wrong AZURE_CLIENT_SECRET. Double-check you copied the secret VALUE (not the Secret ID/name).';
    else if (code === 'invalid_client')
      hint = '❌ invalid_client — the client ID or secret is incorrect.';
    else
      hint = 'Check the error_desc above for details.';

    return json({ ...report, conclusion: hint });
  }

  // ── Token OK — now test a Graph API call ──────────────────────────────────
  const accessToken = tokenJson.access_token as string;
  report.token_step = '✅ Token acquired successfully';

  // Test 1: Basic Graph /me equivalent — list users (needs User.Read.All or User.ReadBasic.All)
  const usersRes = await fetch(
    'https://graph.microsoft.com/v1.0/users?$top=1&$select=id,displayName,mail',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const usersBody = await usersRes.text();
  report.graph_users_test = {
    status: usersRes.status,
    ok:     usersRes.ok,
    result: usersRes.ok ? '✅ User.Read / User.ReadBasic.All — OK' : `❌ ${usersBody.slice(0, 300)}`,
  };

  // Test 2: Mail access (needs Mail.Read)
  if (financeMailbox) {
    const mailRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(financeMailbox)}/mailFolders/inbox/messages?$top=1&$select=id,subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const mailBody = await mailRes.text();
    report.graph_mail_test = {
      status:   mailRes.status,
      mailbox:  financeMailbox,
      ok:       mailRes.ok,
      result:   mailRes.ok ? '✅ Mail.Read — OK' : `❌ ${mailBody.slice(0, 300)}`,
    };
  } else {
    report.graph_mail_test = '⚠️ FINANCE_MAILBOX not set — skipped mail test';
  }

  report.conclusion = '✅ Token acquisition succeeded. Check graph_users_test and graph_mail_test above for permission issues.';
  return json(report);
});
