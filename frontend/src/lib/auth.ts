import { supabase } from './supabase';
import type { Profile } from './supabase';

/** Initiate Azure AD OAuth login. */
export async function signInWithAzureAD() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid profile email',
      // Use Supabase's hosted callback endpoint; it will redirect back to Site URL
      redirectTo: 'https://alcfqmolvnjnmylopsgb.supabase.co/auth/v1/callback',
    },
  });
  if (error) throw error;
}

/** Sign out. */
export async function signOut() {
  await supabase.auth.signOut();
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
