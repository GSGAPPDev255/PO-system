/**
 * manage-users: Admin-only delete + edit (display_name, email, role) for
 * profiles + auth users. Self-contained — no _shared imports (MCP limitation).
 *
 * Actions:
 *   update_user  — change display_name / email / role
 *   delete_user  — permanently remove auth user + profile (with safety checks)
 *
 * All actions require the caller to be an authenticated admin.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Authenticate caller ────────────────────────────────────────────────────
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

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { action } = body;

  try {
    // ── Update user ──────────────────────────────────────────────────────────
    if (action === 'update_user') {
      const id           = String(body.id ?? '');
      const display_name = String(body.display_name ?? '').trim();
      const email        = String(body.email ?? '').trim().toLowerCase();
      const role         = String(body.role ?? '');
      if (!id) return json({ error: 'id is required' }, 400);

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (display_name) updates.display_name = display_name;
      if (email)        updates.email        = email;
      if (role)         updates.role         = role;

      const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id);
      if (error) throw new Error(error.message);

      // Sync auth.users email if it changed
      if (email) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(id, { email });
        if (authErr) {
          throw new Error(`Profile updated, but auth email change failed: ${authErr.message}`);
        }
      }
      return json({ success: true });
    }

    // ── Delete user ──────────────────────────────────────────────────────────
    if (action === 'delete_user') {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'id is required' }, 400);

      if (id === caller.id) {
        return json({ error: 'You cannot delete your own account.' }, 400);
      }

      const { data: target, error: tgtErr } = await supabaseAdmin
        .from('profiles').select('role, display_name, email').eq('id', id).single();
      if (tgtErr) return json({ error: `User not found: ${tgtErr.message}` }, 404);

      // Refuse to delete the last active admin
      if (target.role === 'admin') {
        const { count } = await supabaseAdmin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true);
        if ((count ?? 0) <= 1) {
          return json({ error: 'Cannot delete the last active admin — promote another admin first.' }, 400);
        }
      }

      // Best-effort: NULL out FK references so historical records survive
      const fkTargets: { table: string; col: string }[] = [
        { table: 'purchase_orders', col: 'created_by_id' },
        { table: 'purchase_orders', col: 'updated_by_id' },
        { table: 'purchase_orders', col: 'finance_user_id' },
        { table: 'purchase_orders', col: 'approved_by_id' },
        { table: 'purchase_orders', col: 'exported_by_id' },
        { table: 'audit_log',       col: 'actor_id' },
      ];
      for (const { table, col } of fkTargets) {
        const { error: nullErr } = await supabaseAdmin
          .from(table).update({ [col]: null }).eq(col, id);
        if (nullErr) console.warn(`[manage-users] could not null ${table}.${col}:`, nullErr.message);
      }

      await supabaseAdmin.from('profile_company_access').delete().eq('profile_id', id);

      // Delete auth user — cascades to profile via FK
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authErr) {
        // Fallback: at least remove the profile row
        const { error: profErr2 } = await supabaseAdmin.from('profiles').delete().eq('id', id);
        if (profErr2) throw new Error(`Auth delete failed (${authErr.message}); profile delete also failed (${profErr2.message})`);
        return json({ success: true, warning: `Profile removed but auth user delete failed: ${authErr.message}` });
      }

      return json({ success: true, message: `${target.display_name ?? 'User'} deleted.` });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('manage-users error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
