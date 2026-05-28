/**
 * list-mail-folders: Returns mail folders for a given mailbox.
 *
 * Queries BOTH /mailFolders (root-level) AND /mailFolders/inbox/childFolders
 * and merges the results. This handles folders created by SharePoint at the
 * root level as well as custom subfolders under Inbox.
 *
 * Body:  { mailbox: string }
 * Auth:  admin role required
 * Returns: { folders: Array<{ id, displayName, unreadItemCount, totalItemCount }> }
 *
 * NOTE: Always returns HTTP 200. Graph API errors are surfaced as
 * { error, detail, hint } in the response body so the UI can show
 * the actual message rather than a generic non-2xx error.
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

  type GraphFolder = { id: string; displayName: string; unreadItemCount: number; totalItemCount: number };

  const headers = { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' };
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}`;
  const select = '$select=id,displayName,unreadItemCount,totalItemCount&$top=100';

  // Fetch root-level folders AND inbox child-folders in parallel.
  // We capture both so we handle folders at either level.
  const [rootRes, inboxRes] = await Promise.all([
    fetch(`${base}/mailFolders?${select}`, { headers }),
    fetch(`${base}/mailFolders/inbox/childFolders?${select}`, { headers }),
  ]);

  // Helper to parse a Graph response, returning [] on error with an error note.
  async function parseGraphResponse(
    res: Response,
    label: string,
  ): Promise<{ folders: GraphFolder[]; error?: string }> {
    if (!res.ok) {
      const errBody = await res.text();
      let hint: string | undefined;
      if (res.status === 403) hint = 'The Azure AD app needs Mail.Read Application permission with admin consent.';
      else if (res.status === 404) hint = `Mailbox not found: ${mailbox}.`;
      return {
        folders: [],
        error: `Graph API error on ${label} (${res.status}): ${errBody}${hint ? ' — ' + hint : ''}`,
      };
    }
    const data = await res.json() as { value: GraphFolder[] };
    return { folders: data.value ?? [] };
  }

  const [rootData, inboxData] = await Promise.all([
    parseGraphResponse(rootRes, 'mailFolders'),
    parseGraphResponse(inboxRes, 'mailFolders/inbox/childFolders'),
  ]);

  // If BOTH calls failed, return an error (still as 200 so the UI can read it)
  if (rootData.error && inboxData.error) {
    return json({
      error: 'Could not load folders from Microsoft 365',
      detail: rootData.error,
      detail2: inboxData.error,
      hint: rootData.error.includes('403') || inboxData.error.includes('403')
        ? 'The Azure AD app needs Mail.Read Application permission with admin consent.'
        : rootData.error.includes('404') || inboxData.error.includes('404')
        ? `Mailbox not found: ${mailbox}. Check the email address is correct.`
        : 'Check the Azure AD app credentials and permissions in the Supabase Edge Function secrets.',
    });
  }

  // Merge root folders + inbox children, deduplicating by id.
  const seen = new Set<string>();
  const allFolders: GraphFolder[] = [];
  for (const f of [...rootData.folders, ...inboxData.folders]) {
    if (!seen.has(f.id)) {
      seen.add(f.id);
      allFolders.push(f);
    }
  }

  // Sort: well-known folders first, then alphabetical
  const WELL_KNOWN_ORDER = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email'];
  const sorted = allFolders.sort((a, b) => {
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

  // Include partial error info if one of the two calls failed
  const warnings: string[] = [];
  if (rootData.error) warnings.push(`Root folders: ${rootData.error}`);
  if (inboxData.error) warnings.push(`Inbox children: ${inboxData.error}`);

  return json({
    folders,
    mailbox,
    ...(warnings.length ? { warnings } : {}),
  });
});
