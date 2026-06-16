import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface CompanyOption {
  name: string;
  slug: string;
}

interface CompanyAccess {
  companies: CompanyOption[]; // companies this user may act on
  seesAll: boolean;           // admin/auditor → all companies
  loading: boolean;
}

/**
 * Loads the companies the current user is allowed to act on:
 * admins/auditors get every active company; everyone else only the companies
 * they have an explicit profile_company_access grant for (default-deny).
 */
export function useCompanyAccess(): CompanyAccess {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [seesAll, setSeesAll] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setLoading(false); return; }

      const [companiesRes, accessRes, profileRes] = await Promise.all([
        supabase.from('companies').select('name, slug').eq('is_active', true).order('name'),
        supabase.from('profile_company_access').select('company').eq('profile_id', user.id),
        supabase.from('profiles').select('role').eq('id', user.id).single(),
      ]);
      if (cancelled) return;

      const all = (companiesRes.data as CompanyOption[]) ?? [];
      const accessSlugs = (accessRes.data as { company: string }[] ?? []).map(r => r.company);
      const role = (profileRes.data as { role?: string } | null)?.role;
      const all_ = role === 'admin' || role === 'auditor';

      setSeesAll(all_);
      setCompanies(all_ ? all : all.filter(c => accessSlugs.includes(c.slug)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { companies, seesAll, loading };
}
