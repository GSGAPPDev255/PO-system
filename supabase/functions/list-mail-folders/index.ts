/**
 * list-mail-folders: Returns ALL root-level mail folders for a given mailbox.
 *
 * Queries /mailFolders (not /mailFolders/inbox/childFolders) so it picks up
 * top-level folders such as custom folders created by SharePoint, Teams, etc.
 *
 * Body:  { mailbox: string }
 * Auth:  admin role required
 * Returns: { folders: Array<{ id, displayName, unreadItemCount, totalItemCount }> }
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) return _cachedToken.token;
  const tenantId     = Deno.env.get('AZURE_TENANT_ID')!;
  const clientId     = Deno.env.get('AZURE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET')!;
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth — require admin
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized: missing Authorization header' }, 401);

  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: 'Unauthorized: token rejected', detail: authError?.message ?? null }, 401);
  }

  const { data: callerProfile, error: profErr } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (profErr) return json({ error: 'Profile lookup failed', detail: profErr.message }, 500);
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Forbidden: admin role required', your_role: callerProfile?.role }, 403);
  }

  let body: { mailbox?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const mailbox = (body.mailbox ?? '').trim();
  if (!mailbox) return json({ error: 'mailbox is required' }, 400);

  let graphToken: string;
  try {
    graphToken = await getGraphToken();
  } catch (err) {
    return json({
      error: 'Azure AD token fetch failed',
      detail: (err as Error).message,
      hint: 'Check AZURE_CLIENT_SECRET — most common cause is an expired secret.',
    }, 500);
  }

  // Fetch ALL root-level mail folders (not just Inbox children)
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
    `/mailFolders?$select=id,displayName,unreadItemCount,totalItemCount&$top=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const errBody = await res.text();
    return json({
      error: `Graph API error (${res.status})`,
      detail: errBody,
      hint: res.status === 403
        ? 'The Azure AD app needs Mail.Read Application permission with admin consent.'
        : res.status === 404
        ? `Mailbox not found: ${mailbox}.`
        : undefined,
    }, 500);
  }

  type GraphFolder = { id: string; displayName: string; unreadItemCount: number; totalItemCount: number };

  const data = await res.json() as { value: GraphFolder[] };

  // Sort: put well-known folders first, then alphabetical
  const WELL_KNOWN_ORDER = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email'];
  const sorted = (data.value ?? []).sort((a, b) => {
    const ai = WELL_KNOWN_ORDER.indexOf(a.displayName);
    const bi = WELL_KNOWN_ORDER.indexOf(b.displayName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const folders = [
    // Sentinel — reverts back to Inbox default
    { id: null, displayName: 'Inbox (default)', unreadItemCount: 0, totalItemCount: 0 },
    ...sorted.map((f) => ({
      id:              f.id,
      displayName:     f.displayName,
      unreadItemCount: f.unreadItemCount ?? 0,
      totalItemCount:  f.totalItemCount  ?? 0,
    })),
  ];

  return json({ folders, mailbox });
});
