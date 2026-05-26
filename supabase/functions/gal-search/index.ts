/**
 * gal-search: Searches Azure AD via Microsoft Graph for users by display name
 * or email. Self-contained (no _shared imports) and returns the verbatim Graph
 * error if anything goes wrong — admin-actions was swallowing the real cause.
 *
 * Body: { query: string }
 * Auth: admin role required.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized: missing Authorization header' }, 401);

  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: 'Unauthorized: token rejected', detail: authError?.message ?? null }, 401);
  }
  const caller = userData.user;

  const { data: callerProfile, error: profErr } = await supabaseAdmin
    .from('profiles').select('role').eq('id', caller.id).single();
  if (profErr) return json({ error: 'Profile lookup failed', detail: profErr.message }, 500);
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Forbidden: admin role required', your_role: callerProfile?.role }, 403);
  }

  let body: { query?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const query = String(body.query ?? '').trim();
  if (!query || query.length < 2) return json({ error: 'query must be at least 2 characters' }, 400);

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

  // Try $search first (requires ConsistencyLevel: eventual + User.Read.All).
  // If it returns 403/permission error, fall back to $filter startswith which
  // requires only User.ReadBasic.All — gives less complete results but works.
  const encQ = encodeURIComponent(query);

  const searchUrl =
    `https://graph.microsoft.com/v1.0/users` +
    `?$search="displayName:${encQ}" OR "mail:${encQ}"` +
    `&$select=id,displayName,mail,userPrincipalName,department,jobTitle,accountEnabled` +
    `&$top=15&$filter=accountEnabled eq true`;

  let res = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${graphToken}`,
      'Content-Type': 'application/json',
      ConsistencyLevel: 'eventual',
    },
  });

  if (!res.ok) {
    const errBody = await res.text();
    // Fallback: filter by startswith — works with User.ReadBasic.All only.
    const fallbackUrl =
      `https://graph.microsoft.com/v1.0/users` +
      `?$filter=accountEnabled eq true and ` +
      `(startswith(displayName,'${query.replace(/'/g, "''")}') or ` +
      `startswith(mail,'${query.replace(/'/g, "''")}') or ` +
      `startswith(userPrincipalName,'${query.replace(/'/g, "''")}'))` +
      `&$select=id,displayName,mail,userPrincipalName,department,jobTitle` +
      `&$top=15`;

    const fb = await fetch(fallbackUrl, {
      headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
    });

    if (!fb.ok) {
      const fbBody = await fb.text();
      return json({
        error: `Graph search failed (${res.status})`,
        detail: errBody,
        fallback_error: `Graph fallback failed (${fb.status}): ${fbBody}`,
        hint: 'The Azure AD app likely needs User.ReadBasic.All (or User.Read.All) Application permission with admin consent granted.',
      }, 500);
    }
    res = fb;
  }

  const data = await res.json() as { value: Array<{
    id: string;
    displayName: string;
    mail: string | null;
    userPrincipalName: string;
    department: string | null;
    jobTitle: string | null;
  }> };

  return json({ users: data.value ?? [] });
});
