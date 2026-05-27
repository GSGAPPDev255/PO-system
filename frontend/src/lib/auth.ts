import { supabase } from './supabase';
import type { Profile } from './supabase';

/** Initiate Azure AD OAuth login.
 *
 *  prompt=select_account: even when Azure has a cached SSO session, show the
 *  account picker. This prevents the "signed out but immediately back in" issue
 *  where Azure silently re-authenticates using the enterprise SSO cookie.
 */
export async function signInWithAzureAD() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid profile email',
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });
  if (error) throw error;
}

/** Sign out — clears both the local Supabase session AND the Azure AD SSO cookie.
 *
 *  Why Azure AD matters: supabase.auth.signOut() only clears the local token.
 *  Azure AD keeps its own session cookie at login.microsoftonline.com. Without
 *  hitting Azure's logout endpoint, the next sign-in attempt is silently
 *  auto-approved by AAD — so the user appears to be bounced straight back in,
 *  making it look like sign-out never happened.
 *
 *  Flow:
 *   1. Clear local Supabase session (best effort, 3s timeout)
 *   2. Force-wipe all auth keys from localStorage
 *   3. Redirect to Azure AD's /logout endpoint, which clears the AAD cookie
 *      and then redirects back to our /login page
 */
export async function signOut() {
  // 1. Tell Supabase to invalidate the server-side session (best effort).
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('signOut timeout')), 3000),
      ),
    ]);
  } catch { /* ignore — we clear locally regardless */ }

  // 2. Force-wipe ALL Supabase auth tokens and our profile cache from localStorage.
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('sb-')) keysToRemove.push(key);  // catch all sb- keys
      if (key === 'posystem_profile_cache') keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }

  // 2b. Also wipe sessionStorage — Supabase v2 can store tokens there too,
  //     and some browsers prefer it over localStorage.
  try {
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('sb-')) sessionKeysToRemove.push(key);
    }
    sessionKeysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* storage unavailable */ }

  // 3. Redirect through Azure AD's logout endpoint to clear the AAD SSO cookie.
  //    post_logout_redirect_uri sends the user back to our login page afterwards.
  //    Using /common/ works for any tenant without needing the tenant ID here.
  const postLogoutUri = encodeURIComponent(`${window.location.origin}/login`);
  window.location.assign(
    `https://login.microsoftonline.com/common/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutUri}`,
  );
}

/** Get the current user's profile from the profiles table. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) return null;
  return data as Profile;
}

/** Get a signed URL for an invoice file (valid 1 hour). */
export async function getInvoiceSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('invoices')
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
