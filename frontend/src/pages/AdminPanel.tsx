/**
 * AdminPanel — four tabs:
 *  1. Users      — view all profiles, invite new users, change roles, activate/deactivate
 *  2. Approvers  — search Azure AD to add approvers, or manually add external approvers
 *  3. Alerts     — configure CC emails, admin notification address
 *  4. System     — view function health, trigger email-intake manually
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../lib/supabase';

type Tab = 'users' | 'approvers' | 'suppliers' | 'nominals' | 'companies' | 'alerts' | 'system';

interface SystemSetting { key: string; value: string; description: string }

const ROLE_OPTIONS: UserRole[] = ['admin', 'finance', 'approver', 'auditor', 'staff'];

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin:    'Full system access — manage users, settings, exports',
  finance:  'Review invoices, assign approvers, generate CSV exports',
  approver: 'Approve or reject invoices assigned to them',
  auditor:  'Read-only access to all records and audit trail',
  staff:    'Submit and track personal expense claims only',
};

const ROLE_TINTS: Record<UserRole, { bg: string; color: string; border: string }> = {
  admin:    { bg: 'var(--warning-soft)', color: 'var(--warning)', border: 'rgba(154, 107, 30, 0.25)' },
  finance:  { bg: 'var(--info-soft)',    color: 'var(--info)',    border: 'rgba(45, 85, 114, 0.25)' },
  approver: { bg: 'var(--success-soft)', color: 'var(--success)', border: 'rgba(58, 106, 63, 0.25)' },
  auditor:  { bg: 'var(--accent-soft)',  color: 'var(--accent-text)', border: 'rgba(181, 78, 28, 0.25)' },
  staff:    { bg: 'rgba(139,92,246,0.1)', color: '#A78BFA', border: 'rgba(139,92,246,0.25)' },
};

const TAB_META: { id: Tab; number: string; label: string }[] = [
  { id: 'users',     number: '01', label: 'Users' },
  { id: 'approvers', number: '02', label: 'Approvers' },
  { id: 'suppliers', number: '03', label: 'Suppliers' },
  { id: 'nominals',  number: '04', label: 'Nominals' },
  { id: 'companies', number: '05', label: 'Companies' },
  { id: 'alerts',    number: '06', label: 'Alerts' },
  { id: 'system',    number: '07', label: 'System' },
];

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div style={s.page}>
      {/* Masthead */}
      <div style={s.masthead} className="animate-rise">
        <div style={s.kicker}>
          <span style={s.kickerRule} /> Administration
        </div>
        <h1 style={s.pageTitle}>
          The <em style={s.pageTitleEm}>control panel</em>.
        </h1>
        <p style={s.subtitle}>
          Users, approvers, companies, mailboxes, and system health — all in one place.
        </p>
      </div>

      {/* Tab bar */}
      <div style={s.tabBar} className="animate-rise delay-1">
        {TAB_META.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              style={{ ...s.tab, ...(active ? s.tabActive : {}) }}
              onClick={() => setTab(t.id)}
            >
              <span style={{ ...s.tabNumber, ...(active ? s.tabNumberActive : {}) }}>{t.number}</span>
              <span style={s.tabLabel}>{t.label}</span>
              {active && <span style={s.tabIndicator} />}
            </button>
          );
        })}
      </div>

      <div style={s.content}>
        {tab === 'users'     && <UsersTab />}
        {tab === 'approvers' && <ApproversTab />}
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'nominals'  && <NominalsTab />}
        {tab === 'companies' && <CompaniesTab />}
        {tab === 'alerts'    && <AlertsTab />}
        {tab === 'system'    && <SystemTab />}
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

interface InviteForm { email: string; display_name: string; role: UserRole }
const EMPTY_INVITE: InviteForm = { email: '', display_name: '', role: 'finance' };

interface GalUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  department: string | null;
  jobTitle: string | null;
}

interface CompanyAccess { profile_id: string; company: string }

function UsersTab() {
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [companies, setCompanies]     = useState<{ slug: string; name: string }[]>([]);
  const [accessMap, setAccessMap]     = useState<Record<string, string[]>>({});  // profile_id → company slugs
  const [expandedAccess, setExpandedAccess] = useState<string | null>(null);  // profile_id being edited
  const [accessSaving, setAccessSaving]     = useState<string | null>(null);
  const [editingId, setEditingId]           = useState<string | null>(null);   // profile being edited inline
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [msg, setMsg]                 = useState('');
  const [msgType, setMsgType]         = useState<'success' | 'error'>('success');
  const [showInvite, setShowInvite]   = useState(false);
  const [inviting, setInviting]       = useState(false);
  const [inviteForm, setInviteForm]   = useState<InviteForm>(EMPTY_INVITE);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // GAL search
  const [galQuery, setGalQuery]       = useState('');
  const [galResults, setGalResults]   = useState<GalUser[]>([]);
  const [galSearching, setGalSearching] = useState(false);
  const [galError, setGalError]       = useState<string | null>(null);

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, companiesRes, accessRes, authRes] = await Promise.all([
        supabase.from('profiles').select('*').order('display_name'),
        supabase.from('companies').select('slug, name').eq('is_active', true).order('name'),
        supabase.from('profile_company_access').select('profile_id, company'),
        supabase.auth.getUser(),
      ]);
      if (profilesRes.error) { setMsg('Could not load users: ' + profilesRes.error.message); setMsgType('error'); }
      setProfiles((profilesRes.data as Profile[]) ?? []);
      setCompanies((companiesRes.data as { slug: string; name: string }[]) ?? []);
      setCurrentUserId(authRes.data.user?.id ?? null);
      // Build access map: profile_id → [company slugs]
      const map: Record<string, string[]> = {};
      for (const row of (accessRes.data as CompanyAccess[]) ?? []) {
        if (!map[row.profile_id]) map[row.profile_id] = [];
        map[row.profile_id].push(row.company);
      }
      setAccessMap(map);
    } catch (e) {
      setMsg('Load failed: ' + (e as Error).message); setMsgType('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeRole(id: string, role: UserRole) {
    // Block self-role changes
    if (id === currentUserId) {
      flash('You cannot change your own role. Ask another admin to do this.', 'error');
      return;
    }
    // Block demoting the last admin
    const adminCount = profiles.filter((p) => p.role === 'admin').length;
    const target = profiles.find((p) => p.id === id);
    if (target?.role === 'admin' && role !== 'admin' && adminCount <= 1) {
      flash('Cannot demote the last admin — assign another admin first.', 'error');
      return;
    }
    setSaving(id);
    const { error } = await supabase.from('profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash('Role updated.'); await load(); }
    setSaving(null);
  }

  async function toggleActive(id: string, current: boolean) {
    setSaving(id);
    const { error } = await supabase.from('profiles').update({ is_active: !current, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash('Status updated.'); await load(); }
    setSaving(null);
  }

  async function editUser(id: string, display_name: string, email: string) {
    setSaving(id);
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'update_user', id, display_name, email },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      flash('User updated.');
      setEditingId(null);
      await load();
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setSaving(null);
  }

  async function deleteUser(id: string, name: string) {
    if (id === currentUserId) {
      flash('You cannot delete your own account.', 'error');
      return;
    }
    if (!confirm(`Permanently delete ${name}?\n\nThis removes their sign-in and profile but keeps their existing POs and audit entries (actor will show as "deleted user").`)) {
      return;
    }
    setSaving(id);
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'delete_user', id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      flash(data?.message ?? `${name} deleted.`);
      await load();
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setSaving(null);
  }

  async function archiveUser(id: string, currentlyArchived: boolean) {
    if (id === currentUserId) {
      flash('You cannot archive your own account.', 'error');
      return;
    }
    setSaving(id);
    const { error } = await supabase
      .from('profiles')
      .update({ is_archived: !currentlyArchived, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(currentlyArchived ? 'User restored from archive.' : 'User archived — they can no longer sign in.');
      await load();
    }
    setSaving(null);
  }

  async function saveCompanyAccess(profileId: string, selectedSlugs: string[]) {
    setAccessSaving(profileId);
    try {
      // Delete existing then insert selected — simple replace approach
      const { error: delError } = await supabase
        .from('profile_company_access')
        .delete()
        .eq('profile_id', profileId);
      if (delError) throw new Error(delError.message);

      if (selectedSlugs.length > 0) {
        const rows = selectedSlugs.map((company) => ({ profile_id: profileId, company }));
        const { error: insError } = await supabase
          .from('profile_company_access')
          .insert(rows);
        if (insError) throw new Error(insError.message);
      }

      flash(selectedSlugs.length === 0
        ? 'Access reset — user can now see all companies.'
        : `Access saved — ${selectedSlugs.length} school${selectedSlugs.length !== 1 ? 's' : ''} assigned.`);
      setExpandedAccess(null);
      await load();
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setAccessSaving(null);
  }

  // Debounced GAL search
  useEffect(() => {
    if (galQuery.trim().length < 2) { setGalResults([]); setGalError(null); return; }
    const timer = setTimeout(async () => {
      setGalSearching(true);
      setGalError(null);
      try {
        const { data, error } = await supabase.functions.invoke('gal-search', {
          body: { query: galQuery.trim() },
        });
        if (!error && data?.users) {
          setGalResults(data.users as GalUser[]);
        } else {
          setGalResults([]);
          // Build a readable error for the admin to act on
          const detail = data?.detail ?? data?.fallback_error ?? error?.message ?? 'Unknown error';
          const hint = data?.hint ?? '';
          setGalError(`Directory search failed: ${detail}${hint ? ` — ${hint}` : ''}`);
        }
      } catch (e) {
        setGalResults([]);
        setGalError(`Directory search exception: ${(e as Error).message}`);
      }
      setGalSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [galQuery]);

  function selectGalUser(u: GalUser) {
    setInviteForm({
      ...inviteForm,
      email: (u.mail ?? u.userPrincipalName).toLowerCase(),
      display_name: u.displayName,
    });
    setGalQuery('');
    setGalResults([]);
  }

  async function inviteUser() {
    const { email, display_name, role } = inviteForm;
    if (!email.trim() || !display_name.trim()) {
      flash('Email and full name are required.', 'error');
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'invite_user', email: email.trim().toLowerCase(), display_name: display_name.trim(), role },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      flash(`Invitation sent to ${email.trim().toLowerCase()}`);
      setInviteForm(EMPTY_INVITE);
      setGalQuery('');
      setGalResults([]);
      setShowInvite(false);
      await load();
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setInviting(false);
  }

  if (loading) return <div style={s.loading}>Loading users…</div>;

  const archivedCount = profiles.filter((p) => (p as Profile & { is_archived?: boolean }).is_archived).length;
  const visibleProfiles = profiles.filter((p) =>
    showArchived ? true : !(p as Profile & { is_archived?: boolean }).is_archived
  );

  return (
    <div>
      <SectionHeader
        title="System users"
        subtitle="All users who can sign in. Invite new staff, change roles, or deactivate accounts."
        msg={msg}
        msgType={msgType}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {archivedCount > 0 && (
              <button
                className="btn"
                style={showArchived ? s.btnDanger : s.btnSecondary}
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
              </button>
            )}
            <button className="btn" style={s.btnPrimary} onClick={() => setShowInvite((v) => !v)}>
              {showInvite ? 'Cancel' : '+ Invite User'}
            </button>
          </div>
        }
      />

      {showInvite && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New invite</div>
          <div style={s.addFormTitle}>Invite a new user</div>
          <div style={s.addFormSub}>
            Search the directory to find someone, or type their details manually. They'll receive an invitation email with a sign-in link.
          </div>

          {/* GAL search */}
          <div style={{ marginTop: 16, marginBottom: 4 }}>
            <label style={s.label}>Search directory (Azure AD)</label>
            <div style={{ position: 'relative', marginTop: 6 }}>
              <input
                style={{ ...s.input, width: '100%', boxSizing: 'border-box', paddingLeft: 36 }}
                value={galQuery}
                placeholder="Type a name or email to search…"
                onChange={(e) => setGalQuery(e.target.value)}
              />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--ink-faint)', pointerEvents: 'none' }}>
                {galSearching ? '⏳' : '⌕'}
              </span>
            </div>

            {/* Results dropdown */}
            {galResults.length > 0 && (
              <div style={gi.dropdown}>
                {galResults.map((u) => (
                  <button
                    key={u.id}
                    style={gi.dropdownItem}
                    onClick={() => selectGalUser(u)}
                  >
                    <div style={gi.dropdownName}>{u.displayName}</div>
                    <div style={gi.dropdownMeta}>
                      {(u.mail ?? u.userPrincipalName).toLowerCase()}
                      {u.department && <> · {u.department}</>}
                      {u.jobTitle && <> · {u.jobTitle}</>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {galQuery.trim().length >= 2 && !galSearching && galResults.length === 0 && !galError && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 6, fontStyle: 'italic' }}>
                No results found — fill in manually below.
              </div>
            )}
            {galError && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(160,49,53,0.07)', border: '1px solid rgba(160,49,53,0.22)', borderRadius: 6, fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.5 }}>
                <strong>⚠ Azure AD directory search unavailable.</strong><br />
                {galError.includes('AADSTS7000215') || galError.includes('invalid_client') || galError.includes('client secret')
                  ? 'The Azure AD client secret has expired. Ask your IT admin to generate a new secret in the Azure portal (App registrations → Certificates & secrets) and update the AZURE_CLIENT_SECRET in Supabase Edge Function secrets.'
                  : galError.includes('Authorization_RequestDenied') || galError.includes('insufficient_scope')
                    ? 'The Azure AD app is missing the required Graph API permission (User.ReadBasic.All). Ask IT to grant admin consent in the Azure portal.'
                    : galError
                }
              </div>
            )}
          </div>

          {/* Manual fields (pre-filled from GAL selection) */}
          <div style={{ ...s.formGrid, marginTop: 14 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Email address *</label>
              <input
                style={s.input}
                type="email"
                value={inviteForm.email}
                placeholder="jane@gardenerschools.com"
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Full name *</label>
              <input
                style={s.input}
                value={inviteForm.display_name}
                placeholder="e.g. Jane Smith"
                onChange={(e) => setInviteForm({ ...inviteForm, display_name: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Role</label>
              <select
                style={s.input}
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as UserRole })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}{r === 'admin' ? ' — full access' : ''}
                  </option>
                ))}
              </select>
              <div style={s.roleHint}>{ROLE_DESCRIPTIONS[inviteForm.role]}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="btn" style={s.btnPrimary} disabled={inviting} onClick={inviteUser}>
              {inviting ? 'Sending…' : 'Send invitation →'}
            </button>
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowInvite(false); setInviteForm(EMPTY_INVITE); setGalQuery(''); setGalResults([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={s.card}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Name</th>
              <th style={s.th}>Email</th>
              <th style={s.th}>Role</th>
              <th style={s.th}>School access</th>
              <th style={s.th}>Status</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProfiles.map((p, idx) => {
              const pEx = p as Profile & { is_archived?: boolean };
              const isArchived = pEx.is_archived === true;
              const userCompanies = accessMap[p.id] ?? [];
              const isFinance = p.role === 'finance';
              const isExpanded = expandedAccess === p.id;
              const isSelf = p.id === currentUserId;
              return (
                <React.Fragment key={p.id}>
                  <tr key={p.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}), opacity: isArchived ? 0.5 : 1 }}>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={s.name}>{p.display_name}</div>
                        {isSelf && <span style={gu.youBadge}>You</span>}
                        {isArchived && <span style={gu.archivedBadge}>Archived</span>}
                      </div>
                    </td>
                    <td style={{ ...s.td, ...s.mono }}>{p.email}</td>
                    <td style={s.td}>
                      <span style={{
                        ...s.roleBadge,
                        background: ROLE_TINTS[p.role].bg,
                        color: ROLE_TINTS[p.role].color,
                        border: `1px solid ${ROLE_TINTS[p.role].border}`,
                      }}>
                        {p.role}
                      </span>
                    </td>
                    <td style={s.td}>
                      {!isFinance ? (
                        <span style={s.faint}>
                          {p.role === 'admin' || p.role === 'auditor' ? 'All (by role)' : '—'}
                        </span>
                      ) : userCompanies.length === 0 ? (
                        <button style={ua.accessChipAll} onClick={() => setExpandedAccess(isExpanded ? null : p.id)}>
                          All schools ↓
                        </button>
                      ) : (
                        <button style={ua.accessChipLimited} onClick={() => setExpandedAccess(isExpanded ? null : p.id)}>
                          {userCompanies.length} school{userCompanies.length !== 1 ? 's' : ''} ↓
                        </button>
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span style={{
                          ...s.statusDot,
                          background: isArchived ? 'rgba(139,92,246,0.4)' : p.is_active ? 'var(--success)' : 'var(--ink-faint)',
                        }} />
                        <span style={{ fontSize: 12, color: isArchived ? 'var(--ink-faint)' : p.is_active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                          {isArchived ? 'Archived' : p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      {isSelf ? (
                        <span style={gu.selfLockNote}>Your account — protected</span>
                      ) : isArchived ? (
                        <button
                          className="btn"
                          style={s.btnSecondary}
                          disabled={saving === p.id}
                          onClick={() => archiveUser(p.id, true)}
                        >
                          {saving === p.id ? '…' : 'Restore'}
                        </button>
                      ) : (
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <select
                            style={s.selectSm}
                            value={p.role}
                            disabled={saving === p.id}
                            onChange={(e) => changeRole(p.id, e.target.value as UserRole)}
                          >
                            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button
                            className="btn"
                            style={s.btnSecondary}
                            disabled={saving === p.id}
                            onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                            title="Edit name or email"
                          >
                            Edit
                          </button>
                          <button
                            className="btn"
                            style={p.is_active ? s.btnDanger : s.btnSecondary}
                            disabled={saving === p.id}
                            onClick={() => toggleActive(p.id, p.is_active)}
                          >
                            {saving === p.id ? '…' : p.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          {!p.is_active && (
                            <button
                              className="btn"
                              style={gu.archiveBtn}
                              disabled={saving === p.id}
                              onClick={() => archiveUser(p.id, false)}
                              title="Archive — hide this user from the list"
                            >
                              Archive
                            </button>
                          )}
                          <button
                            className="btn"
                            style={s.btnDanger}
                            disabled={saving === p.id}
                            onClick={() => deleteUser(p.id, p.display_name)}
                            title="Permanently delete this user"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Inline user-edit row */}
                  {editingId === p.id && !isArchived && (
                    <tr key={`${p.id}-edit`}>
                      <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--line)' }}>
                        <UserEditor
                          profile={p}
                          saving={saving === p.id}
                          onSave={(name, email) => editUser(p.id, name, email)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}

                  {/* Inline company access editor */}
                  {isExpanded && isFinance && (
                    <tr key={`${p.id}-access`}>
                      <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--line)' }}>
                        <CompanyAccessEditor
                          profileId={p.id}
                          profileName={p.display_name}
                          companies={companies}
                          currentAccess={userCompanies}
                          saving={accessSaving === p.id}
                          onSave={(slugs) => saveCompanyAccess(p.id, slugs)}
                          onCancel={() => setExpandedAccess(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {profiles.length === 0 && <div style={s.empty}>No users yet.</div>}
      </div>
    </div>
  );
}

// ─── Company Access Editor (inline, used inside Users tab) ────────────────────

function CompanyAccessEditor({
  profileId, profileName, companies, currentAccess, saving, onSave, onCancel,
}: {
  profileId: string;
  profileName: string;
  companies: { slug: string; name: string }[];
  currentAccess: string[];
  saving: boolean;
  onSave: (slugs: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentAccess));

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const noneSelected = selected.size === 0;

  return (
    <div style={ua.editorWrap}>
      <div style={ua.editorHeader}>
        <div>
          <div style={ua.editorKicker}>§ Company access</div>
          <div style={ua.editorTitle}>Schools for <strong>{profileName}</strong></div>
          <div style={ua.editorSub}>
            Tick the schools this user should see. Leave all unticked to give unrestricted access (all schools).
          </div>
        </div>
      </div>

      <div style={ua.checkGrid}>
        {companies.map((c) => {
          const checked = selected.has(c.slug);
          return (
            <label key={c.slug} style={{ ...ua.checkLabel, ...(checked ? ua.checkLabelActive : {}) }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(c.slug)}
                style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
              />
              <span style={ua.checkName}>{c.name}</span>
              <span style={ua.checkSlug}>{c.slug}</span>
            </label>
          );
        })}
      </div>

      {noneSelected && (
        <div style={ua.unrestrictedNote}>
          ✓ No schools selected — this user will see <strong>all companies</strong> (unrestricted access).
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          className="btn"
          style={s.btnPrimary}
          disabled={saving}
          onClick={() => onSave(Array.from(selected))}
        >
          {saving ? 'Saving…' : noneSelected ? 'Save (unrestricted) →' : `Save ${selected.size} school${selected.size !== 1 ? 's' : ''} →`}
        </button>
        <button className="btn" style={s.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Inline user editor (rename / change email) ──────────────────────────────

function UserEditor({
  profile, saving, onSave, onCancel,
}: {
  profile: Profile;
  saving: boolean;
  onSave: (display_name: string, email: string) => void;
  onCancel: () => void;
}) {
  const [name, setName]   = useState(profile.display_name);
  const [email, setEmail] = useState(profile.email);

  const noChange = name.trim() === profile.display_name && email.trim().toLowerCase() === profile.email.toLowerCase();

  return (
    <div style={ue.wrap}>
      <div style={ue.header}>
        <div style={ue.kicker}>§ Edit user</div>
        <div style={ue.title}>{profile.display_name}</div>
      </div>
      <div style={ue.grid}>
        <div>
          <label style={ue.label}>Full name</label>
          <input style={ue.input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={ue.label}>Email address</label>
          <input style={ue.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={ue.warn}>
            Changing email also updates the Supabase auth account — they will sign in with the new address next time.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button
          className="btn"
          style={s.btnPrimary}
          disabled={saving || noChange || !name.trim() || !email.trim()}
          onClick={() => onSave(name.trim(), email.trim().toLowerCase())}
        >
          {saving ? 'Saving…' : 'Save changes →'}
        </button>
        <button className="btn" style={s.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const ue: Record<string, React.CSSProperties> = {
  wrap: { padding: '20px 24px', background: 'var(--paper)', borderTop: '2px solid var(--accent)' },
  header: { marginBottom: 14 },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 },
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.18em',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    color: 'var(--ink)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  warn: {
    fontSize: 11,
    color: 'var(--ink-faint)',
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 1.4,
  },
};

// Company access UI styles
const ua: Record<string, React.CSSProperties> = {
  accessChipAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    background: 'rgba(16,185,129,0.1)',
    color: 'var(--success)',
    border: '1px solid rgba(16,185,129,0.25)',
    cursor: 'pointer',
  },
  accessChipLimited: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    border: '1px solid rgba(0,198,224,0.25)',
    cursor: 'pointer',
  },
  editorWrap: {
    padding: '20px 24px',
    background: 'var(--paper)',
    borderTop: '2px solid var(--accent)',
  },
  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  editorKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  editorTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
    marginBottom: 4,
  },
  editorSub: {
    fontSize: 12.5,
    color: 'var(--ink-muted)',
    lineHeight: 1.5,
  },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 10,
    marginTop: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--line-strong)',
    cursor: 'pointer',
    background: 'var(--paper-bright)',
    transition: 'border-color 0.12s, background 0.12s',
  },
  checkLabelActive: {
    borderColor: 'var(--accent)',
    background: 'var(--accent-soft)',
  },
  checkName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    flex: 1,
  },
  checkSlug: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9.5,
    color: 'var(--ink-faint)',
  },
  unrestrictedNote: {
    marginTop: 12,
    padding: '10px 14px',
    background: 'rgba(16,185,129,0.07)',
    border: '1px dashed rgba(16,185,129,0.3)',
    borderRadius: 7,
    fontSize: 12.5,
    color: 'var(--success)',
    lineHeight: 1.5,
  },
};

// ─── Approvers Tab ────────────────────────────────────────────────────────────

interface Approver {
  id: string;
  display_name: string;
  email: string;
  department: string | null;
  company: string | null;
  is_active: boolean;
  synced_at: string;
}

const EMPTY_APPROVER = { display_name: '', email: '', department: '' };

function ApproversTab() {
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_APPROVER);
  const [saving, setSaving]       = useState(false);
  const [acting, setActing]       = useState<string | null>(null);
  const [msg, setMsg]             = useState('');
  const [msgType, setMsgType]     = useState<'success' | 'error'>('success');

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('approvers')
      .select('*')
      .order('display_name');
    if (error) flash('Could not load approvers: ' + error.message, 'error');
    setApprovers((data as Approver[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return approvers;
    return approvers.filter((a) =>
      a.display_name.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      (a.department ?? '').toLowerCase().includes(q),
    );
  }, [approvers, search]);

  async function addApprover() {
    const { display_name, email, department } = form;
    if (!display_name.trim() || !email.trim()) {
      flash('Name and email are required.', 'error'); return;
    }
    setSaving(true);
    const { error } = await supabase.from('approvers').insert({
      display_name: display_name.trim(),
      email:        email.trim().toLowerCase(),
      department:   department.trim() || null,
      is_active:    true,
      synced_at:    new Date().toISOString(),
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${display_name.trim()} added as approver.`);
      setForm(EMPTY_APPROVER);
      setShowForm(false);
      await load();
    }
    setSaving(false);
  }

  async function toggleActive(a: Approver) {
    setActing(a.id);
    const { error } = await supabase.from('approvers').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${a.display_name} ${a.is_active ? 'deactivated' : 'activated'}.`); await load(); }
    setActing(null);
  }

  async function deleteApprover(a: Approver) {
    if (!window.confirm(`Permanently delete ${a.display_name}? This cannot be undone.`)) return;
    setActing(a.id);
    const { error } = await supabase.from('approvers').delete().eq('id', a.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${a.display_name} removed.`); await load(); }
    setActing(null);
  }

  return (
    <div>
      <SectionHeader
        title="Approvers"
        subtitle="People who can approve invoices. Add or remove them manually — no directory sync."
        msg={msg}
        msgType={msgType}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              style={{ ...s.input, width: 220, margin: 0 }}
              placeholder="Search approvers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn" style={s.btnPrimary} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Add approver'}
            </button>
          </div>
        }
      />

      {/* Add form */}
      {showForm && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New approver</div>
          <div style={s.addFormTitle}>Add an approver</div>
          <div style={s.addFormSub}>
            Enter the person's details. Their email must match their Microsoft 365 sign-in address.
          </div>
          <div style={{ ...s.formGrid, marginTop: 16 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Full name *</label>
              <input style={s.input} value={form.display_name} placeholder="e.g. Jane Smith"
                onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Email address *</label>
              <input style={s.input} type="email" value={form.email} placeholder="jane@gardenerschools.com"
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Department</label>
              <input style={s.input} value={form.department} placeholder="e.g. Finance"
                onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn" style={s.btnPrimary} disabled={saving} onClick={addApprover}>
              {saving ? 'Saving…' : 'Add approver →'}
            </button>
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowForm(false); setForm(EMPTY_APPROVER); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Approvers list */}
      <div style={s.card}>
        {loading ? (
          <div style={s.loading}>Loading approvers…</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            {search ? `No approvers matching "${search}".` : 'No approvers yet. Add one above to get started.'}
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Department</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, idx) => (
                <tr key={a.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}) }}>
                  <td style={s.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={ap.avatar}>{a.display_name.charAt(0).toUpperCase()}</div>
                      <div style={s.name}>{a.display_name}</div>
                    </div>
                  </td>
                  <td style={{ ...s.td, ...s.mono }}>{a.email}</td>
                  <td style={{ ...s.td, color: 'var(--ink-muted)', fontSize: 12.5 }}>
                    {a.department ?? <span style={s.faint}>—</span>}
                  </td>
                  <td style={s.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ ...s.statusDot, background: a.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                      <span style={{ fontSize: 12, color: a.is_active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn"
                        style={a.is_active ? s.btnSecondary : s.btnPrimary}
                        disabled={acting === a.id}
                        onClick={() => toggleActive(a)}
                      >
                        {acting === a.id ? '…' : a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn"
                        style={s.btnDanger}
                        disabled={acting === a.id}
                        onClick={() => deleteApprover(a)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Approvers-tab-specific styles
const ap: Record<string, React.CSSProperties> = {
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(0,180,216,0.2) 0%, rgba(6,214,160,0.15) 100%)',
    border: '1px solid rgba(0,198,224,0.25)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    flexShrink: 0,
  },
};

// ─── Suppliers Tab ───────────────────────────────────────────────────────────

interface SupplierRow {
  code: string;
  name: string;
  short_name: string | null;
  payment_group: string | null;
  is_active: boolean;
}

const EMPTY_SUPPLIER = { code: '', name: '', short_name: '', payment_group: '' };
const PAYMENT_GROUPS = ['', 'bacs', 'cheque', 'direct_debit', 'card', 'cash'];

function SuppliersTab() {
  const [suppliers, setSuppliers]   = useState<SupplierRow[]>([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [acting, setActing]         = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm]       = useState(EMPTY_SUPPLIER);
  const [addSaving, setAddSaving]   = useState(false);
  const [msg, setMsg]               = useState('');
  const [msgType, setMsgType]       = useState<'success' | 'error'>('success');

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('suppliers')
      .select('code, name, short_name, payment_group, is_active')
      .order('name');
    if (error) flash('Could not load suppliers: ' + error.message, 'error');
    setSuppliers((data as SupplierRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addSupplier() {
    const { code, name, short_name, payment_group } = addForm;
    if (!code.trim() || !name.trim()) {
      flash('Supplier code and name are required.', 'error');
      return;
    }
    setAddSaving(true);
    const { error } = await supabase.from('suppliers').insert({
      code:          code.trim().toUpperCase(),
      name:          name.trim(),
      short_name:    short_name.trim() || null,
      payment_group: payment_group || null,
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${name.trim()} added.`);
      setAddForm(EMPTY_SUPPLIER);
      setShowAddForm(false);
      await load();
    }
    setAddSaving(false);
  }

  async function toggleActive(sup: SupplierRow) {
    setActing(sup.code);
    const { error } = await supabase
      .from('suppliers')
      .update({ is_active: !sup.is_active })
      .eq('code', sup.code);
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${sup.name} ${sup.is_active ? 'deactivated' : 'activated'}.`);
      await load();
    }
    setActing(null);
  }

  async function deleteSupplier(sup: SupplierRow) {
    if (!confirm(`Permanently delete "${sup.name}" (${sup.code})?\n\nThis won't affect existing invoices — they keep the code as text.`)) return;
    setActing(sup.code);
    const { error } = await supabase.from('suppliers').delete().eq('code', sup.code);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${sup.name} deleted.`); await load(); }
    setActing(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(sup =>
      sup.code.toLowerCase().includes(q) ||
      sup.name.toLowerCase().includes(q) ||
      (sup.short_name?.toLowerCase().includes(q) ?? false),
    );
  }, [suppliers, search]);

  return (
    <div>
      <SectionHeader
        title="Supplier master list"
        subtitle={`${suppliers.length} suppliers. Deactivate to hide from the picker, or delete to remove permanently.`}
        msg={msg}
        msgType={msgType}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              style={{ ...s.input, width: 220 }}
              placeholder="Search code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn" style={s.btnPrimary} onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? 'Cancel' : '+ Add supplier'}
            </button>
          </div>
        }
      />

      {showAddForm && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New supplier</div>
          <div style={s.addFormTitle}>Add a supplier</div>
          <div style={s.addFormSub}>Enter the Sage 200 supplier account code and name. The code must match exactly what appears in Sage.</div>
          <div style={{ ...s.formGrid, gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 14 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Account code *</label>
              <input
                style={{ ...s.input, fontFamily: 'var(--font-mono)' }}
                value={addForm.code}
                placeholder="e.g. ACME001"
                onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Supplier name *</label>
              <input
                style={s.input}
                value={addForm.name}
                placeholder="e.g. Acme Supplies Ltd"
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Short name</label>
              <input
                style={s.input}
                value={addForm.short_name}
                placeholder="e.g. Acme"
                onChange={(e) => setAddForm({ ...addForm, short_name: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Payment group</label>
              <select
                style={s.input}
                value={addForm.payment_group}
                onChange={(e) => setAddForm({ ...addForm, payment_group: e.target.value })}
              >
                {PAYMENT_GROUPS.map((pg) => (
                  <option key={pg} value={pg}>
                    {pg ? pg.charAt(0).toUpperCase() + pg.slice(1).replace('_', ' ') : '— Standard —'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={s.btnPrimary} disabled={addSaving} onClick={addSupplier}>
              {addSaving ? 'Saving…' : 'Add supplier →'}
            </button>
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowAddForm(false); setAddForm(EMPTY_SUPPLIER); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={s.card}>
        {loading ? (
          <div style={s.loading}>Loading suppliers…</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Code</th>
                <th style={s.th}>Name</th>
                <th style={s.th}>Payment group</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sup, idx) => (
                <tr key={sup.code} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}), opacity: sup.is_active ? 1 : 0.5 }}>
                  <td style={{ ...s.td, ...s.mono, fontSize: 12 }}>{sup.code}</td>
                  <td style={s.td}>
                    <div style={s.name}>{sup.name}</div>
                    {sup.short_name && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{sup.short_name}</div>}
                  </td>
                  <td style={s.td}>
                    {sup.payment_group && sup.payment_group !== 'supplier' ? (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent-text)', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
                        {sup.payment_group}
                      </span>
                    ) : (
                      <span style={s.faint}>—</span>
                    )}
                  </td>
                  <td style={s.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...s.statusDot, background: sup.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                      <span style={{ fontSize: 12, color: sup.is_active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                        {sup.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        className="btn"
                        style={s.btnSecondary}
                        disabled={acting === sup.code}
                        onClick={() => toggleActive(sup)}
                      >
                        {acting === sup.code ? '…' : sup.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn"
                        style={s.btnDanger}
                        disabled={acting === sup.code}
                        onClick={() => deleteSupplier(sup)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div style={s.empty}>
            {search ? `No suppliers match "${search}".` : 'No suppliers yet. Add one above to get started.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Nominals Tab ─────────────────────────────────────────────────────────────

interface NominalRow {
  id: string;
  code: string;
  name: string;
  cost_centre: string | null;
  department: string | null;
  is_active: boolean;
}

const EMPTY_NOMINAL = { code: '', name: '', cost_centre: '', department: '' };

function NominalsTab() {
  const [nominals, setNominals]       = useState<NominalRow[]>([]);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [acting, setActing]           = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm]         = useState(EMPTY_NOMINAL);
  const [addSaving, setAddSaving]     = useState(false);
  const [msg, setMsg]                 = useState('');
  const [msgType, setMsgType]         = useState<'success' | 'error'>('success');

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('nominal_codes')
      .select('id, code, name, cost_centre, department, is_active')
      .order('code');
    if (error) flash('Could not load nominal codes: ' + error.message, 'error');
    setNominals((data as NominalRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addNominal() {
    const { code, name, cost_centre, department } = addForm;
    if (!code.trim() || !name.trim()) {
      flash('Account number and name are required.', 'error');
      return;
    }
    setAddSaving(true);
    const { error } = await supabase.from('nominal_codes').insert({
      code:        code.trim(),
      name:        name.trim(),
      cost_centre: cost_centre.trim() || null,
      department:  department.trim() || null,
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${name.trim()} added.`);
      setAddForm(EMPTY_NOMINAL);
      setShowAddForm(false);
      await load();
    }
    setAddSaving(false);
  }

  async function toggleActive(n: NominalRow) {
    setActing(n.id);
    const { error } = await supabase
      .from('nominal_codes')
      .update({ is_active: !n.is_active })
      .eq('id', n.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${n.name} ${n.is_active ? 'deactivated' : 'activated'}.`); await load(); }
    setActing(null);
  }

  async function deleteNominal(n: NominalRow) {
    if (!confirm(`Permanently delete "${n.name}" (${n.code})?\n\nThis won't affect existing invoices.`)) return;
    setActing(n.id);
    const { error } = await supabase.from('nominal_codes').delete().eq('id', n.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${n.name} deleted.`); await load(); }
    setActing(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nominals;
    return nominals.filter(n =>
      n.code.toLowerCase().includes(q) ||
      n.name.toLowerCase().includes(q) ||
      (n.cost_centre?.toLowerCase().includes(q) ?? false) ||
      (n.department?.toLowerCase().includes(q) ?? false),
    );
  }, [nominals, search]);

  return (
    <div>
      <SectionHeader
        title="Nominal codes"
        subtitle={`${nominals.length} codes. These populate the cost centre and nominal account dropdowns on invoice review.`}
        msg={msg}
        msgType={msgType}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              style={{ ...s.input, width: 220 }}
              placeholder="Search code, name or CC…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn" style={s.btnPrimary} onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? 'Cancel' : '+ Add nominal'}
            </button>
          </div>
        }
      />

      {showAddForm && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New nominal code</div>
          <div style={s.addFormTitle}>Add a nominal code</div>
          <div style={s.addFormSub}>
            Enter the Sage 200 nominal account number, description, and the default cost centre and department that will pre-fill on invoice review.
          </div>
          <div style={{ ...s.formGrid, gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 14 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Account number *</label>
              <input
                style={{ ...s.input, fontFamily: 'var(--font-mono)' }}
                value={addForm.code}
                placeholder="e.g. 5001"
                onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Description *</label>
              <input
                style={s.input}
                value={addForm.name}
                placeholder="e.g. Curriculum Resources"
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Cost centre</label>
              <input
                style={{ ...s.input, fontFamily: 'var(--font-mono)' }}
                value={addForm.cost_centre}
                placeholder="e.g. HB"
                onChange={(e) => setAddForm({ ...addForm, cost_centre: e.target.value })}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Department</label>
              <input
                style={{ ...s.input, fontFamily: 'var(--font-mono)' }}
                value={addForm.department}
                placeholder="e.g. 01"
                onChange={(e) => setAddForm({ ...addForm, department: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={s.btnPrimary} disabled={addSaving} onClick={addNominal}>
              {addSaving ? 'Saving…' : 'Add nominal →'}
            </button>
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowAddForm(false); setAddForm(EMPTY_NOMINAL); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={s.card}>
        {loading ? (
          <div style={s.loading}>Loading nominal codes…</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Account number</th>
                <th style={s.th}>Description</th>
                <th style={s.th}>Cost centre</th>
                <th style={s.th}>Department</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n, idx) => (
                <tr key={n.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}), opacity: n.is_active ? 1 : 0.5 }}>
                  <td style={{ ...s.td, ...s.mono, fontSize: 12, fontWeight: 600 }}>{n.code}</td>
                  <td style={s.td}><div style={s.name}>{n.name}</div></td>
                  <td style={s.td}>
                    {n.cost_centre ? (
                      <span style={nm.ccBadge}>{n.cost_centre}</span>
                    ) : (
                      <span style={s.faint}>—</span>
                    )}
                  </td>
                  <td style={{ ...s.td, ...s.mono, fontSize: 12 }}>
                    {n.department ?? <span style={s.faint}>—</span>}
                  </td>
                  <td style={s.td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...s.statusDot, background: n.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                      <span style={{ fontSize: 12, color: n.is_active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                        {n.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        className="btn"
                        style={s.btnSecondary}
                        disabled={acting === n.id}
                        onClick={() => toggleActive(n)}
                      >
                        {acting === n.id ? '…' : n.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn"
                        style={s.btnDanger}
                        disabled={acting === n.id}
                        onClick={() => deleteNominal(n)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div style={s.empty}>
            {search ? `No nominal codes match "${search}".` : 'No nominal codes yet. Add one above to get started.'}
          </div>
        )}
      </div>
    </div>
  );
}

// Nominals-tab-specific styles
const nm: Record<string, React.CSSProperties> = {
  ccBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(0,180,216,0.08)',
    color: 'var(--accent)',
    border: '1px solid rgba(0,180,216,0.20)',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
  },
};

// ─── Companies Tab ────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

interface Mailbox {
  id: string;
  company_id: string;
  email: string;
  label: string;
  is_active: boolean;
  folder_id:   string | null;
  folder_name: string | null;
}

interface MailFolder {
  id: string | null;
  displayName: string;
  unreadItemCount: number;
  totalItemCount: number;
}

interface PollResult {
  mailbox: string;
  company: string;
  folder: string;
  dry_run: boolean;
  unread_found: number;
  processed: number;
  skipped: number;
  duplicates: number;
  reminders: number;
  would_process: number;
  errors: string[];
  messages: Array<{ subject: string; from: string; intent: string; has_attachments: boolean; action: string; summary: string }>;
}

function CompaniesTab() {
  const [companies, setCompanies]       = useState<Company[]>([]);
  const [mailboxes, setMailboxes]       = useState<Mailbox[]>([]);
  const [loading, setLoading]           = useState(true);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [addingMailboxFor, setAddingMailboxFor] = useState<string | null>(null);
  const [companyForm, setCompanyForm]   = useState({ name: '', slug: '' });
  const [mailboxForm, setMailboxForm]   = useState({ email: '', label: '' });
  const [saving, setSaving]             = useState(false);
  const [toggling, setToggling]         = useState<string | null>(null);
  const [msg, setMsg]                   = useState('');
  const [msgType, setMsgType]           = useState<'success' | 'error'>('success');

  // Folder picker state
  const [folderPickerFor, setFolderPickerFor] = useState<string | null>(null); // mailbox.id
  const [foldersList, setFoldersList]         = useState<MailFolder[]>([]);
  const [foldersLoading, setFoldersLoading]   = useState(false);
  const [foldersError, setFoldersError]       = useState<string | null>(null);
  const [savingFolder, setSavingFolder]       = useState<string | null>(null);

  // Per-mailbox poll (test / force) state
  const [pollResultFor, setPollResultFor] = useState<string | null>(null); // mailbox.id
  const [pollResult, setPollResult]       = useState<PollResult | null>(null);
  const [pollError, setPollError]         = useState<string | null>(null);
  const [polling, setPolling]             = useState<string | null>(null); // mailbox.id being polled

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, mRes] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('mailboxes').select('*').order('label'),
    ]);
    if (cRes.error) flash('Could not load companies: ' + cRes.error.message, 'error');
    if (mRes.error) flash('Could not load mailboxes: ' + mRes.error.message, 'error');
    setCompanies((cRes.data as Company[]) ?? []);
    setMailboxes((mRes.data as Mailbox[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive slug from name automatically
  function nameToSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  async function addCompany() {
    const { name, slug } = companyForm;
    if (!name.trim() || !slug.trim()) { flash('Name and slug are required.', 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('companies').insert({
      name: name.trim(),
      slug: slug.trim(),
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${name.trim()} added.`);
      setCompanyForm({ name: '', slug: '' });
      setShowAddCompany(false);
      await load();
    }
    setSaving(false);
  }

  async function toggleCompany(c: Company) {
    setToggling(c.id);
    const { error } = await supabase.from('companies').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${c.name} ${c.is_active ? 'deactivated' : 'activated'}.`); await load(); }
    setToggling(null);
  }

  async function addMailbox(companyId: string) {
    const { email, label } = mailboxForm;
    if (!email.trim() || !label.trim()) { flash('Email and label are required.', 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('mailboxes').insert({
      company_id: companyId,
      email: email.trim().toLowerCase(),
      label: label.trim(),
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${email.trim().toLowerCase()} added.`);
      setMailboxForm({ email: '', label: '' });
      setAddingMailboxFor(null);
      await load();
    }
    setSaving(false);
  }

  async function openFolderPicker(m: Mailbox) {
    if (folderPickerFor === m.id) { setFolderPickerFor(null); return; }
    setFolderPickerFor(m.id);
    setFoldersError(null);
    setFoldersList([]);
    setFoldersLoading(true);
    try {
      // Get session token for auth header
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in — session expired');

      // Use fetch directly to capture error response body
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-mail-folders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mailbox: m.email }),
        },
      );

      const responseData = await response.json();

      if (!response.ok) {
        // Function returned an error (with details in the JSON body)
        const err = responseData.error || `HTTP ${response.status}`;
        const hint = responseData.hint ? ` — ${responseData.hint}` : '';
        throw new Error(err + hint);
      }

      setFoldersList((responseData.folders ?? []) as MailFolder[]);
    } catch (err) {
      setFoldersError((err as Error).message);
    } finally {
      setFoldersLoading(false);
    }
  }

  async function saveMailboxFolder(m: Mailbox, folder: MailFolder) {
    setSavingFolder(m.id);
    const { error } = await supabase
      .from('mailboxes')
      .update({ folder_id: folder.id, folder_name: folder.id ? folder.displayName : null })
      .eq('id', m.id);
    if (error) { flash('Failed to save folder: ' + error.message, 'error'); }
    else { flash(`${m.email} → folder set to "${folder.displayName}".`); }
    setSavingFolder(null);
    setFolderPickerFor(null);
    await load();
  }

  async function pollMailbox(m: Mailbox, dryRun: boolean) {
    setPolling(m.id);
    setPollResultFor(m.id);
    setPollResult(null);
    setPollError(null);
    setFolderPickerFor(null); // close folder picker if open on this row
    try {
      const { data, error } = await supabase.functions.invoke('poll-mailbox', {
        body: { mailbox_id: m.id, dry_run: dryRun },
      });
      if (data?.error) throw new Error(data.error + (data.detail ? ` — ${data.detail}` : ''));
      if (error) throw new Error(error.message);
      setPollResult(data as PollResult);
      // A live poll may have created POs — refresh nothing here, but flash a hint.
      if (!dryRun && (data as PollResult).processed > 0) {
        flash(`${(data as PollResult).processed} invoice(s) imported from ${m.email}.`);
      }
    } catch (err) {
      setPollError((err as Error).message);
    } finally {
      setPolling(null);
    }
  }

  async function toggleMailbox(m: Mailbox) {
    setToggling(m.id);
    const { error } = await supabase.from('mailboxes').update({ is_active: !m.is_active }).eq('id', m.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${m.email} ${m.is_active ? 'disabled' : 'enabled'}.`); await load(); }
    setToggling(null);
  }

  async function deleteMailbox(m: Mailbox) {
    if (!confirm(`Remove ${m.email}? This won't affect existing invoices.`)) return;
    setToggling(m.id);
    const { error } = await supabase.from('mailboxes').delete().eq('id', m.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${m.email} removed.`); await load(); }
    setToggling(null);
  }

  if (loading) return <div style={s.loading}>Loading companies…</div>;

  return (
    <div>
      <SectionHeader
        title="Companies & mailboxes"
        subtitle="Each company has its own set of email inboxes. New invoices are tagged to the company they arrived in."
        msg={msg}
        msgType={msgType}
        actions={
          <button className="btn" style={s.btnPrimary} onClick={() => setShowAddCompany((v) => !v)}>
            {showAddCompany ? 'Cancel' : '+ Add company'}
          </button>
        }
      />

      {showAddCompany && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New company</div>
          <div style={s.addFormTitle}>Add a company</div>
          <div style={s.addFormSub}>The slug is used internally to tag invoices — use lowercase_underscores.</div>
          <div style={{ ...s.formGrid, gridTemplateColumns: '1fr 1fr', marginTop: 14 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Company name *</label>
              <input
                style={s.input}
                value={companyForm.name}
                placeholder="e.g. Kew House School"
                onChange={(e) => {
                  const name = e.target.value;
                  setCompanyForm({ name, slug: nameToSlug(name) });
                }}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Slug * (auto-generated)</label>
              <input
                style={{ ...s.input, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                value={companyForm.slug}
                placeholder="kew_house_school"
                onChange={(e) => setCompanyForm({ ...companyForm, slug: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={s.btnPrimary} disabled={saving} onClick={addCompany}>
              {saving ? 'Saving…' : 'Add company →'}
            </button>
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowAddCompany(false); setCompanyForm({ name: '', slug: '' }); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {companies.map((c) => {
          const cMailboxes = mailboxes.filter((m) => m.company_id === c.id);
          const expanded = expandedId === c.id;
          return (
            <div key={c.id} style={{ ...s.card, marginBottom: 0, opacity: c.is_active ? 1 : 0.6 }}>
              {/* Company header row */}
              <div
                style={co.companyRow}
                onClick={() => setExpandedId(expanded ? null : c.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <span style={{ ...co.chevron, transform: expanded ? 'rotate(90deg)' : 'none' }}>›</span>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 1 }}>{c.slug}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                    {cMailboxes.length} mailbox{cMailboxes.length !== 1 ? 'es' : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...s.statusDot, background: c.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                    <span style={{ fontSize: 11.5, color: c.is_active ? 'var(--ink-soft)' : 'var(--ink-faint)' }}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                  <button
                    className="btn"
                    style={c.is_active ? s.btnDanger : s.btnSecondary}
                    disabled={toggling === c.id}
                    onClick={(e) => { e.stopPropagation(); toggleCompany(c); }}
                  >
                    {toggling === c.id ? '…' : c.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              {/* Expanded mailboxes */}
              {expanded && (
                <div style={co.mailboxSection}>
                  <div style={co.mailboxHeader}>
                    <span style={co.mailboxHeaderLabel}>Mailboxes</span>
                    <button
                      className="btn"
                      style={s.btnSecondary}
                      onClick={() => { setAddingMailboxFor(addingMailboxFor === c.id ? null : c.id); setMailboxForm({ email: '', label: '' }); }}
                    >
                      {addingMailboxFor === c.id ? 'Cancel' : '+ Add mailbox'}
                    </button>
                  </div>

                  {addingMailboxFor === c.id && (
                    <div style={co.addMailboxForm}>
                      <div style={{ ...s.formGrid, gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
                        <div style={s.formGroup}>
                          <label style={s.label}>Email address *</label>
                          <input
                            style={s.input}
                            type="email"
                            value={mailboxForm.email}
                            placeholder="purchases@school.com"
                            onChange={(e) => setMailboxForm({ ...mailboxForm, email: e.target.value })}
                          />
                        </div>
                        <div style={s.formGroup}>
                          <label style={s.label}>Label *</label>
                          <input
                            style={s.input}
                            value={mailboxForm.label}
                            placeholder="e.g. School Purchases"
                            onChange={(e) => setMailboxForm({ ...mailboxForm, label: e.target.value })}
                          />
                        </div>
                      </div>
                      <button className="btn" style={s.btnPrimary} disabled={saving} onClick={() => addMailbox(c.id)}>
                        {saving ? 'Adding…' : 'Add mailbox →'}
                      </button>
                    </div>
                  )}

                  {cMailboxes.length === 0 ? (
                    <div style={{ padding: '16px 20px', fontSize: 12.5, color: 'var(--ink-faint)', fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
                      No mailboxes yet — add one to start receiving invoices.
                    </div>
                  ) : (
                    <table style={{ ...s.table, borderTop: '1px solid var(--line)' }}>
                      <thead>
                        <tr>
                          <th style={co.mth}>Email</th>
                          <th style={co.mth}>Label</th>
                          <th style={co.mth}>Folder</th>
                          <th style={co.mth}>Status</th>
                          <th style={{ ...co.mth, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cMailboxes.map((m, idx) => (
                          <React.Fragment key={m.id}>
                            <tr style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}), opacity: m.is_active ? 1 : 0.5 }}>
                              <td style={{ ...s.td, ...s.mono, fontSize: 12.5 }}>{m.email}</td>
                              <td style={{ ...s.td, fontSize: 13 }}>{m.label}</td>
                              {/* Folder column */}
                              <td style={s.td}>
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                  <button
                                    style={co.folderBtn}
                                    onClick={() => openFolderPicker(m)}
                                    title="Click to change the folder email-intake reads from"
                                  >
                                    <span style={co.folderIcon}>📁</span>
                                    <span style={co.folderName}>{m.folder_name ?? 'Inbox'}</span>
                                    <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span>
                                  </button>
                                </div>
                              </td>
                              <td style={s.td}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ ...s.statusDot, background: m.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                                  <span style={{ fontSize: 11.5 }}>{m.is_active ? 'Active' : 'Paused'}</span>
                                </span>
                              </td>
                              <td style={{ ...s.td, textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  <button className="btn" style={co.testBtn} disabled={polling === m.id}
                                    onClick={() => pollMailbox(m, true)}
                                    title="Dry run — shows what would be picked up without creating POs or marking emails read">
                                    {polling === m.id ? '…' : 'Test'}
                                  </button>
                                  <button className="btn" style={co.pollBtn} disabled={polling === m.id}
                                    onClick={() => pollMailbox(m, false)}
                                    title="Force a real poll now — imports invoices and marks emails read">
                                    {polling === m.id ? 'Polling…' : 'Poll now'}
                                  </button>
                                  <button className="btn" style={s.btnSecondary} disabled={toggling === m.id}
                                    onClick={() => toggleMailbox(m)}>
                                    {toggling === m.id ? '…' : m.is_active ? 'Pause' : 'Resume'}
                                  </button>
                                  <button className="btn" style={s.btnDanger} disabled={toggling === m.id}
                                    onClick={() => deleteMailbox(m)}>
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {/* Folder picker dropdown row */}
                            {folderPickerFor === m.id && (
                              <tr key={`${m.id}-folder-picker`}>
                                <td colSpan={5} style={{ padding: '0 0 6px', background: 'var(--paper)' }}>
                                  <div style={co.folderPickerWrap}>
                                    <div style={co.folderPickerHeader}>
                                      <span style={co.folderPickerTitle}>
                                        Choose inbox folder for <strong>{m.email}</strong>
                                      </span>
                                      <button style={co.folderPickerClose} onClick={() => setFolderPickerFor(null)}>✕</button>
                                    </div>

                                    {foldersLoading && (
                                      <div style={co.folderPickerMsg}>Loading folders from Microsoft 365…</div>
                                    )}

                                    {foldersError && (
                                      <div style={co.folderPickerErr}>
                                        <strong>Error:</strong> {foldersError}
                                      </div>
                                    )}

                                    {!foldersLoading && !foldersError && foldersList.length > 0 && (
                                      <div style={co.folderList}>
                                        {foldersList.map((f) => {
                                          const isSelected = f.id === null
                                            ? !m.folder_id
                                            : m.folder_id === f.id;
                                          return (
                                            <button
                                              key={f.id ?? '__inbox__'}
                                              style={{
                                                ...co.folderOption,
                                                ...(isSelected ? co.folderOptionActive : {}),
                                              }}
                                              disabled={savingFolder === m.id}
                                              onClick={() => saveMailboxFolder(m, f)}
                                            >
                                              <span style={{ fontSize: 14 }}>{f.id === null ? '📥' : '📁'}</span>
                                              <span style={co.folderOptionName}>{f.displayName}</span>
                                              {f.id !== null && (
                                                <span style={co.folderOptionCount}>
                                                  {f.unreadItemCount > 0
                                                    ? `${f.unreadItemCount} unread`
                                                    : `${f.totalItemCount} total`}
                                                </span>
                                              )}
                                              {isSelected && <span style={co.folderOptionCheck}>✓ Current</span>}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                            {/* Poll result row */}
                            {pollResultFor === m.id && (polling === m.id || pollResult || pollError) && (
                              <tr key={`${m.id}-poll-result`}>
                                <td colSpan={5} style={{ padding: '0 0 6px', background: 'var(--paper)' }}>
                                  <div style={co.pollWrap}>
                                    <div style={co.pollHeader}>
                                      <span style={co.pollTitle}>
                                        {polling === m.id
                                          ? `Polling ${m.email}…`
                                          : pollResult?.dry_run
                                          ? `Test result — ${m.email} (folder: ${pollResult?.folder})`
                                          : `Poll result — ${m.email} (folder: ${pollResult?.folder})`}
                                      </span>
                                      <button style={co.folderPickerClose} onClick={() => { setPollResultFor(null); setPollResult(null); setPollError(null); }}>✕</button>
                                    </div>

                                    {polling === m.id && (
                                      <div style={co.folderPickerMsg}>Contacting Microsoft 365 and classifying unread emails…</div>
                                    )}

                                    {pollError && (
                                      <div style={co.folderPickerErr}><strong>Error:</strong> {pollError}</div>
                                    )}

                                    {pollResult && polling !== m.id && (
                                      <div style={{ padding: '12px 14px' }}>
                                        {pollResult.dry_run && (
                                          <div style={co.pollDryNote}>
                                            🧪 Test mode — nothing was imported and no emails were marked read.
                                          </div>
                                        )}
                                        <div style={co.pollStats}>
                                          <span style={co.pollStat}><strong>{pollResult.unread_found}</strong> unread found</span>
                                          {pollResult.dry_run
                                            ? <span style={{ ...co.pollStat, ...co.pollStatGood }}><strong>{pollResult.would_process}</strong> would import</span>
                                            : <span style={{ ...co.pollStat, ...co.pollStatGood }}><strong>{pollResult.processed}</strong> imported</span>}
                                          <span style={co.pollStat}><strong>{pollResult.skipped}</strong> skipped</span>
                                          {pollResult.duplicates > 0 && <span style={co.pollStat}><strong>{pollResult.duplicates}</strong> duplicate</span>}
                                          {pollResult.reminders > 0 && <span style={co.pollStat}><strong>{pollResult.reminders}</strong> reminder</span>}
                                        </div>

                                        {pollResult.errors.length > 0 && (
                                          <div style={co.folderPickerErr}>
                                            {pollResult.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                                          </div>
                                        )}

                                        {pollResult.messages.length > 0 ? (
                                          <div style={co.pollMsgList}>
                                            {pollResult.messages.map((msg, i) => (
                                              <div key={i} style={co.pollMsgRow}>
                                                <span style={pollMsgIntentStyle(msg.intent)}>{msg.intent}</span>
                                                <span style={co.pollMsgSubject} title={msg.subject}>
                                                  {msg.has_attachments ? '📎 ' : ''}{msg.subject}
                                                </span>
                                                <span style={co.pollMsgAction}>{msg.action}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div style={{ ...co.folderPickerMsg, padding: '8px 0 0' }}>
                                            No unread emails in this folder right now.
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {companies.length === 0 && (
          <div style={{ ...s.card, padding: 36, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13, fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
            No companies yet. Add one above to get started.
          </div>
        )}
      </div>
    </div>
  );
}

// CompaniesTab-specific styles
const co: Record<string, React.CSSProperties> = {
  companyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    cursor: 'pointer',
    borderRadius: 10,
    transition: 'background 0.12s var(--ease)',
  },
  chevron: {
    fontSize: 18,
    color: 'var(--ink-faint)',
    fontFamily: 'var(--font-display)',
    transition: 'transform 0.15s var(--ease)',
    flexShrink: 0,
    lineHeight: 1,
  },
  mailboxSection: {
    borderTop: '1px solid var(--line)',
  },
  mailboxHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 18px',
    background: 'var(--paper)',
  },
  mailboxHeaderLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.18em',
  },
  addMailboxForm: {
    padding: '14px 18px',
    background: 'var(--paper)',
    borderBottom: '1px solid var(--line)',
  },
  mth: {
    padding: '8px 16px',
    textAlign: 'left' as const,
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.14em',
    borderBottom: '1px solid var(--line)',
    background: 'var(--paper)',
  },

  // ── Folder picker ────────────────────────────────────────────────────────
  folderBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 9px',
    fontSize: 11.5,
    background: 'rgba(0,180,216,0.07)',
    border: '1px solid rgba(0,180,216,0.20)',
    borderRadius: 6,
    color: 'var(--accent)',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.12s',
  },
  folderIcon: { fontSize: 12 },
  folderName: { fontWeight: 500, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' },

  folderPickerWrap: {
    margin: '2px 16px 10px',
    background: 'var(--paper-bright)',
    border: '1px solid var(--accent)',
    borderRadius: 10,
    boxShadow: '0 6px 24px rgba(0,180,216,0.12)',
    overflow: 'hidden',
  },
  folderPickerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--line)',
    background: 'rgba(0,180,216,0.04)',
  },
  folderPickerTitle: {
    fontSize: 12,
    color: 'var(--ink-muted)',
  },
  folderPickerClose: {
    background: 'none',
    border: 'none',
    fontSize: 13,
    color: 'var(--ink-faint)',
    cursor: 'pointer',
    padding: '0 2px',
  },
  folderPickerMsg: {
    padding: '14px 16px',
    fontSize: 12.5,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
  },
  folderPickerErr: {
    padding: '12px 16px',
    fontSize: 12,
    color: 'var(--danger)',
    background: 'rgba(244,63,94,0.06)',
  },
  folderList: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    padding: '12px 14px',
  },
  folderOption: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 13px',
    fontSize: 12.5,
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--ink)',
    transition: 'all 0.12s',
    fontFamily: 'var(--font-ui)',
  },
  folderOptionActive: {
    background: 'rgba(0,180,216,0.08)',
    borderColor: 'rgba(0,180,216,0.40)',
    color: 'var(--accent)',
  },
  folderOptionName: { fontWeight: 500 },
  folderOptionCount: {
    fontSize: 10,
    color: 'var(--ink-faint)',
    fontFamily: 'var(--font-mono)',
  },
  folderOptionCheck: {
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    marginLeft: 2,
  },

  // ── Poll now / Test ──────────────────────────────────────────────────────
  testBtn: {
    background: 'rgba(123,97,255,0.10)',
    color: '#7b61ff',
    border: '1px solid rgba(123,97,255,0.30)',
  },
  pollBtn: {
    background: 'rgba(6,214,160,0.12)',
    color: 'var(--success)',
    border: '1px solid rgba(6,214,160,0.30)',
  },
  pollWrap: {
    margin: '2px 16px 10px',
    background: 'var(--paper-bright)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 6px 24px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  pollHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--line)',
    background: 'rgba(6,214,160,0.04)',
  },
  pollTitle: { fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 },
  pollDryNote: {
    fontSize: 11.5,
    color: '#7b61ff',
    background: 'rgba(123,97,255,0.07)',
    border: '1px dashed rgba(123,97,255,0.3)',
    borderRadius: 6,
    padding: '6px 10px',
    marginBottom: 10,
  },
  pollStats: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 10,
  },
  pollStat: {
    fontSize: 11.5,
    color: 'var(--ink-muted)',
    padding: '3px 9px',
    borderRadius: 6,
    background: 'var(--paper)',
    border: '1px solid var(--line)',
  },
  pollStatGood: {
    color: 'var(--success)',
    background: 'rgba(6,214,160,0.08)',
    border: '1px solid rgba(6,214,160,0.25)',
  },
  pollMsgList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: 2,
  },
  pollMsgRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px',
    borderRadius: 6,
    background: 'var(--paper)',
    fontSize: 12,
  },
  pollMsgSubject: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: 'var(--ink)',
  },
  pollMsgAction: {
    fontSize: 10.5,
    fontFamily: 'var(--font-mono)',
    color: 'var(--ink-faint)',
    flexShrink: 0,
  },
};

// Intent badge colour by classification
function pollMsgIntentStyle(intent: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    new_invoice:       { bg: 'rgba(6,214,160,0.12)',  color: 'var(--success)' },
    payment_reminder:  { bg: 'rgba(154,107,30,0.12)', color: 'var(--warning)' },
    statement:         { bg: 'rgba(45,85,114,0.12)',  color: 'var(--info)' },
    remittance_advice: { bg: 'rgba(45,85,114,0.12)',  color: 'var(--info)' },
    credit_note:       { bg: 'rgba(123,97,255,0.12)', color: '#7b61ff' },
    skip:              { bg: 'var(--glass)',          color: 'var(--ink-faint)' },
  };
  const t = map[intent] ?? { bg: 'var(--glass)', color: 'var(--ink-muted)' };
  return {
    fontSize: 9.5,
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '2px 7px',
    borderRadius: 5,
    background: t.bg,
    color: t.color,
    flexShrink: 0,
    width: 110,
    textAlign: 'center',
  };
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

const ALERT_KEYS = [
  'approval_flow_enabled',
  'alert_cc_emails', 'admin_alert_email', 'reminder_days', 'max_reminders',
  'batch_send_enabled', 'batch_send_time', 'batch_send_days',
];

function AlertsTab() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [descs, setDescs]       = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('system_settings').select('*');
        if (error) setMsg('Could not load settings: ' + error.message);
        const vals: Record<string, string> = {};
        const ds: Record<string, string> = {};
        for (const row of (data as SystemSetting[]) ?? []) {
          vals[row.key] = row.value ?? '';
          ds[row.key]   = row.description ?? '';
        }
        setSettings(vals);
        setDescs(ds);
      } catch (e) {
        setMsg('Load failed: ' + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    const updates = ALERT_KEYS.map((key) =>
      supabase.from('system_settings').upsert({
        key,
        value: settings[key] ?? '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
    );
    const results = await Promise.all(updates);
    const errs = results.filter((r) => r.error);
    if (errs.length) setMsg('Some settings failed to save.');
    else setMsg('Settings saved.');
    setSaving(false);
    setTimeout(() => setMsg(''), 3000);
  }

  if (loading) return <div style={s.loading}>Loading settings…</div>;

  return (
    <div>
      <SectionHeader
        title="Alerts & notifications"
        subtitle="Configure who receives emails and how reminders behave."
        msg={msg}
        msgType="success"
      />

      <div style={s.card}>
        <div style={s.settingsGrid}>
          {/* ── Approval workflow toggle ──────────────────────────────────── */}
          <div style={{ padding: '18px 26px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--accent-text)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>§ Approval workflow</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginTop: 12 }}>
              <div style={{ maxWidth: 560 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                  {(settings['approval_flow_enabled'] ?? 'true').toLowerCase() === 'false'
                    ? 'Trial mode — finance files invoices directly'
                    : 'Full approval workflow active'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 5, lineHeight: 1.55 }}>
                  When <strong>enabled</strong>, finance assigns an approver and sends each invoice for email sign-off before it can be exported.
                  When <strong>disabled</strong>, finance reviews, extracts and files invoices straight to ready-for-export — no approver, no approval emails.
                </div>
              </div>
              <select
                style={{ ...s.input, width: 150, flexShrink: 0 }}
                value={(settings['approval_flow_enabled'] ?? 'true').toLowerCase() === 'false' ? 'false' : 'true'}
                onChange={(e) => setSettings({ ...settings, approval_flow_enabled: e.target.value })}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled (trial)</option>
              </select>
            </div>
          </div>

          <SettingRow
            label="CC emails on approvals"
            desc={descs['alert_cc_emails'] ?? 'Comma-separated emails CCed on all approval request emails'}
            value={settings['alert_cc_emails'] ?? ''}
            placeholder="finance@school.com, head@school.com"
            width={380}
            onChange={(v) => setSettings({ ...settings, alert_cc_emails: v })}
          />
          <SettingRow
            label="Admin alert email"
            desc={descs['admin_alert_email'] ?? 'Receives alerts when system errors occur'}
            value={settings['admin_alert_email'] ?? ''}
            placeholder="admin@gardenerschools.com"
            type="email"
            width={380}
            onChange={(v) => setSettings({ ...settings, admin_alert_email: v })}
          />
          <SettingRow
            label="Reminder after (days)"
            desc={descs['reminder_days'] ?? 'Days to wait before sending approval reminder'}
            value={settings['reminder_days'] ?? '3'}
            type="number"
            width={120}
            onChange={(v) => setSettings({ ...settings, reminder_days: v })}
          />
          <SettingRow
            label="Max reminders"
            desc={descs['max_reminders'] ?? 'Maximum reminders per invoice before escalating'}
            value={settings['max_reminders'] ?? '3'}
            type="number"
            width={120}
            onChange={(v) => setSettings({ ...settings, max_reminders: v })}
          />

          {/* ── Batch send schedule ──────────────────────────────────────── */}
          <div style={{ padding: '14px 26px 6px', borderTop: '1px solid var(--line)', marginTop: 8 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--accent-text)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>§ Approval batch schedule</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 6, lineHeight: 1.55 }}>
              When finance marks an invoice ready for approval, they can pick "Send at next batch" — this is the slot used.
            </div>
          </div>
          <SettingRow
            label="Batch enabled"
            desc='Set to "true" to offer the "Send at next batch" option, or "false" to hide it.'
            value={settings['batch_send_enabled'] ?? 'true'}
            placeholder="true"
            width={120}
            onChange={(v) => setSettings({ ...settings, batch_send_enabled: v })}
          />
          <SettingRow
            label="Batch send time"
            desc='Time of day the batch goes out (24h HH:MM, Europe/London).'
            value={settings['batch_send_time'] ?? '09:00'}
            placeholder="09:00"
            width={120}
            onChange={(v) => setSettings({ ...settings, batch_send_time: v })}
          />
          <SettingRow
            label="Batch send days"
            desc='Comma-separated lowercase day names. e.g. "mon,tue,wed,thu,fri" for weekdays only.'
            value={settings['batch_send_days'] ?? 'mon,tue,wed,thu,fri'}
            placeholder="mon,tue,wed,thu,fri"
            width={260}
            onChange={(v) => setSettings({ ...settings, batch_send_days: v })}
          />
        </div>

        <div style={{ padding: '0 26px 26px' }}>
          <button className="btn" style={s.btnPrimary} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save settings →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  label, desc, value, placeholder, type = 'text', width, onChange,
}: {
  label: string; desc: string; value: string; placeholder?: string;
  type?: string; width: number; onChange: (v: string) => void;
}) {
  return (
    <div style={s.settingRow}>
      <div style={s.settingLabel}>
        <div style={s.settingKey}>{label}</div>
        <div style={s.settingDesc}>{desc}</div>
      </div>
      <input
        style={{ ...s.input, width }}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ─── System Tab ───────────────────────────────────────────────────────────────

interface FnStatus { name: string; label: string; schedule: string }

const FUNCTIONS: FnStatus[] = [
  { name: 'email-intake',                 label: 'Email intake',           schedule: 'Every 5 minutes' },
  { name: 'dispatch-scheduled-approvals', label: 'Scheduled approval send', schedule: 'Every 5 minutes' },
  { name: 'reminder-scheduler',           label: 'Reminder scheduler',     schedule: 'Daily · 08:00 UTC' },
  { name: 'finance-digest',               label: 'Finance digest',         schedule: 'Daily · 08:30 UTC' },
  { name: 'invoice-processor',            label: 'Invoice data extraction', schedule: 'On-demand' },
  { name: 'send-approval',                label: 'Send approval',          schedule: 'On-demand' },
  { name: 'process-approval',             label: 'Process approval',       schedule: 'On-demand' },
  { name: 'generate-csv',                 label: 'Generate CSV',           schedule: 'On-demand' },
  { name: 'admin-actions',                label: 'Admin actions',          schedule: 'On-demand' },
];

interface MailboxRow { id: string; email: string; label: string; folder_id: string | null; folder_name: string | null; is_active: boolean }
interface FolderOption { id: string | null; displayName: string; unreadItemCount: number; totalItemCount: number }

function SystemTab() {
  const [triggering, setTriggering]   = useState<string | null>(null);
  const [results, setResults]         = useState<Record<string, string>>({});
  const [stats, setStats]             = useState<{ pos: number; files: number; exports: number; pending: number } | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [sendingDigest, setSendingDigest]       = useState(false);
  const [intakeStatus, setIntakeStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [intakeDetail, setIntakeDetail] = useState('');
  const [diagRunning, setDiagRunning]   = useState(false);
  const [diagResult, setDiagResult]     = useState<string | null>(null);
  // Mailbox folder picker
  const [mailboxes, setMailboxes]         = useState<MailboxRow[]>([]);
  const [folderPickerId, setFolderPickerId] = useState<string | null>(null); // which mailbox is open
  const [folderOptions, setFolderOptions]  = useState<FolderOption[]>([]);
  const [folderLoading, setFolderLoading]  = useState(false);
  const [folderSaving, setFolderSaving]    = useState(false);
  const [folderMsg, setFolderMsg]          = useState('');
  const [folderSelected, setFolderSelected] = useState<string | null | undefined>(undefined); // undefined = not yet chosen

  useEffect(() => {
    (async () => {
      const [posRes, filesRes, exportsRes, pendingRes, mbRes] = await Promise.all([
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
        supabase.from('invoice_files').select('id', { count: 'exact', head: true }),
        supabase.from('csv_exports').select('id', { count: 'exact', head: true }),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending_finance_review'),
        supabase.from('mailboxes').select('id,email,label,folder_id,folder_name,is_active').order('label'),
      ]);
      setStats({
        pos:     posRes.count ?? 0,
        files:   filesRes.count ?? 0,
        exports: exportsRes.count ?? 0,
        pending: pendingRes.count ?? 0,
      });
      setMailboxes((mbRes.data as MailboxRow[]) ?? []);
    })();
  }, []);

  async function openFolderPicker(mb: MailboxRow) {
    setFolderPickerId(mb.id);
    setFolderOptions([]);
    setFolderSelected(undefined);
    setFolderMsg('');
    setFolderLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-mail-folders', {
        body: { mailbox: mb.email },
      });
      if (error || data?.error) {
        setFolderMsg('Could not load folders: ' + (data?.error ?? error?.message));
        setFolderOptions([]);
      } else {
        setFolderOptions(data.folders as FolderOption[]);
        setFolderSelected(mb.folder_id ?? null); // pre-select current
      }
    } catch (e) {
      setFolderMsg('Error: ' + (e as Error).message);
    }
    setFolderLoading(false);
  }

  async function saveFolder(mb: MailboxRow) {
    if (folderSelected === undefined) return;
    setFolderSaving(true);
    const chosen = folderOptions.find((f) => f.id === folderSelected);
    const { error } = await supabase.from('mailboxes').update({
      folder_id:   folderSelected,
      folder_name: chosen?.displayName ?? null,
    }).eq('id', mb.id);
    if (error) {
      setFolderMsg('Save failed: ' + error.message);
    } else {
      setFolderMsg('✓ Saved — email intake will now poll "' + (chosen?.displayName ?? 'Inbox') + '"');
      setMailboxes((prev) => prev.map((m) =>
        m.id === mb.id
          ? { ...m, folder_id: folderSelected, folder_name: chosen?.displayName ?? null }
          : m
      ));
      setTimeout(() => { setFolderPickerId(null); setFolderMsg(''); }, 2500);
    }
    setFolderSaving(false);
  }

  async function runDiagnostics() {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('diagnose-graph', { method: 'POST' });
      if (error) { setDiagResult('Error: ' + error.message); return; }
      setDiagResult(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data));
    } catch (e) {
      setDiagResult('Failed: ' + (e as Error).message);
    } finally {
      setDiagRunning(false);
    }
  }

  async function checkEmailIntake() {
    setIntakeStatus('checking');
    setIntakeDetail('');
    try {
      const { data, error } = await supabase.functions.invoke('email-intake', { method: 'POST' });
      if (error) {
        setIntakeStatus('error');
        setIntakeDetail(error.message);
      } else {
        const text = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        const isError = text.toLowerCase().includes('error') || text.toLowerCase().includes('failed');
        setIntakeStatus(isError ? 'error' : 'ok');
        setIntakeDetail(text);
      }
    } catch (e) {
      setIntakeStatus('error');
      setIntakeDetail((e as Error).message);
    }
  }

  async function trigger(name: string) {
    setTriggering(name);
    setResults((r) => ({ ...r, [name]: 'Running…' }));
    try {
      const { data, error } = await supabase.functions.invoke(name, { method: 'POST' });
      if (error) {
        setResults((r) => ({ ...r, [name]: 'Error: ' + error.message }));
      } else {
        const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
        setResults((r) => ({ ...r, [name]: text }));
      }
    } catch (e) {
      setResults((r) => ({ ...r, [name]: 'Failed: ' + (e as Error).message }));
    }
    setTriggering(null);
  }

  async function sendManualReminders() {
    setSendingReminders(true);
    setResults((r) => ({ ...r, 'manual-reminders': 'Sending…' }));
    try {
      const { data, error } = await supabase.functions.invoke('reminder-scheduler', { method: 'POST' });
      if (error) {
        setResults((r) => ({ ...r, 'manual-reminders': 'Error: ' + error.message }));
      } else {
        const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
        setResults((r) => ({ ...r, 'manual-reminders': 'Sent. ' + text }));
      }
    } catch (e) {
      setResults((r) => ({ ...r, 'manual-reminders': 'Failed: ' + (e as Error).message }));
    }
    setSendingReminders(false);
  }

  async function sendManualDigest() {
    setSendingDigest(true);
    setResults((r) => ({ ...r, 'manual-digest': 'Sending…' }));
    try {
      const { data, error } = await supabase.functions.invoke('finance-digest', { method: 'POST' });
      if (error) {
        setResults((r) => ({ ...r, 'manual-digest': 'Error: ' + error.message }));
      } else {
        const d = data as { sent?: number; failed?: number } | null;
        setResults((r) => ({ ...r, 'manual-digest': `Sent to ${d?.sent ?? 0} recipient${d?.sent !== 1 ? 's' : ''}.${d?.failed ? ` ${d.failed} failed.` : ''}` }));
      }
    } catch (e) {
      setResults((r) => ({ ...r, 'manual-digest': 'Failed: ' + (e as Error).message }));
    }
    setSendingDigest(false);
  }

  return (
    <div>
      <SectionHeader
        title="System health & controls"
        subtitle="Database stats and manual function triggers. Use these to test or recover from issues."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn"
              style={s.btnSecondary}
              disabled={sendingDigest}
              onClick={sendManualDigest}
            >
              {sendingDigest ? 'Sending…' : '📋 Send digest now'}
            </button>
            <button
              className="btn"
              style={s.btnPrimary}
              disabled={sendingReminders}
              onClick={sendManualReminders}
            >
              {sendingReminders ? 'Sending…' : '📧 Send reminders now'}
            </button>
          </div>
        }
      />

      {stats && (
        <div style={s.statsRow}>
          <StatCard label="Invoice files" value={stats.files} />
          <StatCard label="Purchase orders" value={stats.pos} />
          <StatCard label="Pending review" value={stats.pending} />
          <StatCard label="Sage exports" value={stats.exports} />
        </div>
      )}

      {/* Email intake health check */}
      <div style={sy.healthCard}>
        <div style={sy.healthHeader}>
          <div>
            <div style={sy.healthKicker}>§ Email intake</div>
            <div style={sy.healthTitle}>Mailbox connection</div>
            <div style={sy.healthSub}>
              Tests the Microsoft Graph connection and checks for new emails in the finance mailbox.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {intakeStatus !== 'idle' && (
              <span style={{
                ...sy.statusPill,
                ...(intakeStatus === 'ok' ? sy.statusPillOk
                  : intakeStatus === 'error' ? sy.statusPillError
                  : sy.statusPillChecking),
              }}>
                {intakeStatus === 'checking' ? '⏳ Checking…'
                  : intakeStatus === 'ok' ? '✓ Connected'
                  : '✗ Error'}
              </span>
            )}
            <button
              className="btn"
              style={s.btnPrimary}
              disabled={intakeStatus === 'checking'}
              onClick={checkEmailIntake}
            >
              {intakeStatus === 'checking' ? 'Checking…' : 'Test connection'}
            </button>
          </div>
        </div>
        {intakeDetail && (
          <div style={{
            ...sy.healthResult,
            borderColor: intakeStatus === 'ok' ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)',
            background: intakeStatus === 'ok' ? 'rgba(16,185,129,0.05)' : 'rgba(244,63,94,0.05)',
            color: intakeStatus === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{intakeDetail}</pre>
          </div>
        )}
      </div>

      {/* Mailbox folder configuration */}
      <div style={{ ...s.card, marginBottom: 12 }}>
        <div style={sy.healthKicker}>§ Mailbox folder</div>
        <div style={sy.healthTitle}>Which folder to poll for new emails</div>
        <div style={{ ...sy.healthSub, marginBottom: 16 }}>
          By default email-intake reads the main Inbox. Select a subfolder below to restrict it to only that folder.
        </div>
        {mailboxes.filter((m) => m.is_active).map((mb) => (
          <div key={mb.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{mb.email}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                  Currently polling:{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 11.5 }}>
                    {mb.folder_name ?? 'Inbox (default)'}
                  </span>
                </div>
              </div>
              <button
                className="btn"
                style={s.btnSecondary}
                disabled={folderLoading && folderPickerId === mb.id}
                onClick={() => folderPickerId === mb.id ? setFolderPickerId(null) : openFolderPicker(mb)}
              >
                {folderLoading && folderPickerId === mb.id ? '⏳ Loading…'
                  : folderPickerId === mb.id ? 'Cancel'
                  : '📂 Change folder'}
              </button>
            </div>

            {/* Folder picker dropdown */}
            {folderPickerId === mb.id && !folderLoading && (
              <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(0,180,216,0.04)', border: '1px solid rgba(0,180,216,0.15)', borderRadius: 8 }}>
                {folderOptions.length > 0 ? (
                  <>
                    <label style={{ ...s.label, display: 'block', marginBottom: 6 }}>Select folder</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
                      <select
                        style={{ ...s.input, flex: 1, minWidth: 240 }}
                        value={folderSelected === null ? '' : (folderSelected ?? '')}
                        onChange={(e) => setFolderSelected(e.target.value === '' ? null : e.target.value)}
                      >
                        {folderOptions.map((f) => (
                          <option key={f.id ?? '__inbox__'} value={f.id ?? ''}>
                            {f.displayName}
                            {f.totalItemCount > 0 ? ` (${f.unreadItemCount} unread / ${f.totalItemCount} total)` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn"
                        style={s.btnPrimary}
                        disabled={folderSaving || folderSelected === undefined}
                        onClick={() => saveFolder(mb)}
                      >
                        {folderSaving ? 'Saving…' : 'Save →'}
                      </button>
                    </div>
                  </>
                ) : null}
                {folderMsg && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: folderMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
                    {folderMsg}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Azure AD / Graph diagnostics */}
      <div style={{ ...s.card, marginBottom: 12 }}>
        <div style={{ ...sy.healthRow, flexWrap: 'wrap' as const, gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={sy.healthKicker}>§ Azure diagnostics</div>
            <div style={sy.healthTitle}>Test Graph credentials</div>
            <div style={sy.healthSub}>
              Checks AZURE_TENANT_ID, AZURE_CLIENT_ID &amp; AZURE_CLIENT_SECRET and reports exactly what's wrong.
            </div>
          </div>
          <button
            className="btn"
            style={s.btnSecondary}
            disabled={diagRunning}
            onClick={runDiagnostics}
          >
            {diagRunning ? '⏳ Running…' : '🔍 Run diagnostics'}
          </button>
        </div>
        {diagResult && (
          <div style={{ ...sy.healthResult, marginTop: 0, borderColor: 'rgba(123,97,255,0.2)', background: 'rgba(123,97,255,0.04)' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11.5, color: 'var(--ink)' }}>{diagResult}</pre>
          </div>
        )}
      </div>

      {results['manual-digest'] && (
        <div style={{ ...s.card, marginBottom: 12, backgroundColor: 'var(--paper-bright)', borderLeft: '3px solid var(--accent-3)' }}>
          <div style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: results['manual-digest'].startsWith('Error') || results['manual-digest'].startsWith('Failed') ? 'var(--danger)' : 'var(--success)' }}>
            📋 Digest: {results['manual-digest']}
          </div>
        </div>
      )}
      {results['manual-reminders'] && (
        <div style={{ ...s.card, marginBottom: 20, backgroundColor: 'var(--paper-bright)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: results['manual-reminders'].startsWith('Error') || results['manual-reminders'].startsWith('Failed') ? 'var(--danger)' : 'var(--success)' }}>
            {results['manual-reminders']}
          </div>
        </div>
      )}

      <div style={s.card}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Function</th>
              <th style={s.th}>Schedule</th>
              <th style={s.th}>Last result</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {FUNCTIONS.map((fn, idx) => (
              <tr key={fn.name} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}) }}>
                <td style={s.td}>
                  <div style={s.name}>{fn.label}</div>
                  <div style={{ ...s.mono, fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
                    {fn.name}
                  </div>
                </td>
                <td style={{ ...s.td, ...s.mono, fontSize: 11.5 }}>{fn.schedule}</td>
                <td style={s.td}>
                  {results[fn.name] ? (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: results[fn.name].startsWith('Error') || results[fn.name].startsWith('Failed')
                        ? 'var(--danger)' : 'var(--success)',
                    }}>
                      {results[fn.name].length > 120
                        ? results[fn.name].slice(0, 120) + '…'
                        : results[fn.name]}
                    </span>
                  ) : (
                    <span style={s.faint}>—</span>
                  )}
                </td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <button
                    className="btn"
                    style={s.btnSecondary}
                    disabled={triggering === fn.name}
                    onClick={() => trigger(fn.name)}
                  >
                    {triggering === fn.name ? 'Running…' : 'Run now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={s.statCard}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValue}>{value}</div>
    </div>
  );
}

function SectionHeader({
  title, subtitle, actions, msg, msgType = 'success',
}: {
  title: string; subtitle: string;
  actions?: React.ReactNode;
  msg?: string;
  msgType?: 'success' | 'error';
}) {
  return (
    <div style={s.sectionHeader}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.sectionTitle}>{title}</div>
        <div style={s.sectionSub}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {msg && (
          <div style={{ ...s.toast, ...(msgType === 'error' ? s.toastError : {}) }}>
            <span style={s.toastLabel}>{msgType === 'error' ? 'Error' : 'Done'}</span>
            {msg}
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },

  masthead: {
    paddingBottom: 18,
    borderBottom: '1px solid var(--line)',
  },
  kicker: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    marginBottom: 14,
  },
  kickerRule: { width: 28, height: 1, background: 'var(--accent)' },
  pageTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 4vw, 54px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.02,
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },
  pageTitleEm: {
    fontStyle: 'italic',
    color: 'var(--accent)',
    fontVariationSettings: "'opsz' 144, 'SOFT' 100",
  },
  subtitle: {
    margin: '14px 0 0',
    maxWidth: 620,
    fontSize: 14.5,
    lineHeight: 1.6,
    color: 'var(--ink-muted)',
  },

  tabBar: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid var(--line)',
    marginBottom: 8,
  },
  tab: {
    position: 'relative',
    padding: '14px 22px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 10,
    color: 'var(--ink-muted)',
    transition: 'color 0.15s var(--ease)',
  },
  tabActive: {
    color: 'var(--ink)',
  },
  tabNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    fontWeight: 500,
    letterSpacing: '0.08em',
  },
  tabNumberActive: { color: 'var(--accent)' },
  tabLabel: {
    fontSize: 14,
    fontWeight: 500,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    background: 'var(--accent)',
  },

  content: {},

  loading: {
    textAlign: 'center',
    padding: 60,
    color: 'var(--ink-muted)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 15,
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    color: 'var(--ink-muted)',
  },

  card: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    overflow: 'auto',
    marginBottom: 18,
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    borderBottom: '1px solid var(--line-strong)',
    background: 'var(--paper-bright)',
  },
  row: { transition: 'background 0.1s var(--ease)' },
  rowAlt: { background: 'var(--paper)' },
  td: {
    padding: '12px 16px',
    fontSize: 13,
    borderBottom: '1px solid var(--line)',
    verticalAlign: 'middle',
    color: 'var(--ink-soft)',
  },
  name: { fontWeight: 500, color: 'var(--ink)' },
  mono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--ink-muted)',
  },
  faint: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    color: 'var(--ink-faint)',
  },
  empty: {
    textAlign: 'center',
    padding: 36,
    color: 'var(--ink-muted)',
    fontSize: 13,
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
  },

  roleBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  badgeAzure: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10,
    background: 'var(--info-soft)',
    color: 'var(--info)',
    border: '1px solid rgba(45, 85, 114, 0.25)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  badgeManual: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10,
    background: 'transparent',
    color: 'var(--ink-muted)',
    border: '1px dashed var(--line-strong)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  statusDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
  },

  toast: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 10,
    background: 'var(--ink)',
    color: 'var(--paper)',
    padding: '8px 14px',
    borderRadius: 7,
    fontSize: 12.5,
  },
  toastError: {
    background: 'var(--danger)',
  },
  toastLabel: {
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    opacity: 0.8,
  },

  selectSm: {
    padding: '5px 10px',
    borderRadius: 6,
    border: '1px solid var(--line-strong)',
    fontSize: 12,
    background: 'var(--paper)',
    color: 'var(--ink-soft)',
  },

  btnPrimary: {
    padding: '9px 18px',
    fontSize: 13,
    borderRadius: 7,
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: '1px solid var(--ink)',
    fontWeight: 500,
  },
  btnSecondary: {
    padding: '7px 14px',
    fontSize: 12,
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--ink-soft)',
    border: '1px solid var(--line-strong)',
    fontWeight: 500,
  },
  btnDanger: {
    padding: '7px 14px',
    fontSize: 12,
    borderRadius: 6,
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    border: '1px solid rgba(160, 49, 53, 0.25)',
    fontWeight: 500,
  },

  addForm: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    padding: '22px 24px',
    marginBottom: 18,
  },
  addFormKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  addFormTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
    marginBottom: 4,
  },
  addFormSub: {
    fontSize: 12.5,
    color: 'var(--ink-muted)',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    marginBottom: 16,
  },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: {
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  roleHint: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    marginTop: 4,
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  toggleLabel: {
    fontSize: 12,
    color: 'var(--ink-soft)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    padding: '8px 12px',
    borderRadius: 7,
    border: '1px solid var(--line-strong)',
    fontSize: 13,
    background: 'var(--paper)',
    color: 'var(--ink)',
    outline: 'none',
  },

  settingsGrid: {
    padding: 26,
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
  },
  settingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 24,
    paddingBottom: 24,
    borderBottom: '1px dashed var(--line-strong)',
  },
  settingLabel: { flex: 1 },
  settingKey: {
    fontFamily: 'var(--font-display)',
    fontSize: 17,
    fontWeight: 500,
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
    marginBottom: 4,
  },
  settingDesc: {
    fontSize: 12.5,
    color: 'var(--ink-muted)',
    lineHeight: 1.5,
  },

  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 14,
    marginBottom: 18,
  },
  statCard: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '22px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  statLabel: {
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontWeight: 600,
  },
  statValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 40,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.03em',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    fontVariationSettings: "'opsz' 144, 'SOFT' 40",
  },

};

// ─── System Tab styles ─────────────────────────────────────────────────────────

const sy: Record<string, React.CSSProperties> = {
  healthCard: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '22px 24px',
    marginBottom: 18,
  },
  healthHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
  },
  healthKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  healthTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
    marginBottom: 4,
  },
  healthSub: {
    fontSize: 12.5,
    color: 'var(--ink-muted)',
    lineHeight: 1.5,
    maxWidth: 520,
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
  },
  statusPillOk: {
    background: 'rgba(16,185,129,0.1)',
    color: 'var(--success)',
    border: '1px solid rgba(16,185,129,0.3)',
  },
  statusPillError: {
    background: 'rgba(244,63,94,0.1)',
    color: 'var(--danger)',
    border: '1px solid rgba(244,63,94,0.3)',
  },
  statusPillChecking: {
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    border: '1px solid rgba(0,198,224,0.25)',
  },
  healthResult: {
    marginTop: 16,
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    lineHeight: 1.6,
    maxHeight: 240,
    overflowY: 'auto',
  },
};

// ─── GAL invite search styles ─────────────────────────────────────────────────

const gi: Record<string, React.CSSProperties> = {
  dropdown: {
    marginTop: 4,
    background: 'var(--paper-bright)',
    border: '1px solid var(--line-strong)',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 8px 24px -8px rgba(20,24,31,0.18)',
    zIndex: 10,
    maxHeight: 280,
    overflowY: 'auto',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 14px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--line)',
    cursor: 'pointer',
    transition: 'background 0.1s var(--ease)',
  },
  dropdownName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    marginBottom: 2,
  },
  dropdownMeta: {
    fontSize: 11,
    color: 'var(--ink-faint)',
    fontFamily: 'var(--font-mono)',
  },
};

// ─── Guard UI styles (self-lock protection) ───────────────────────────────────

const gu: Record<string, React.CSSProperties> = {
  youBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    border: '1px solid rgba(0,198,224,0.3)',
    flexShrink: 0,
  },
  selfLockNote: {
    fontSize: 11,
    color: 'var(--ink-faint)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  archivedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    background: 'rgba(139,92,246,0.1)',
    color: '#A78BFA',
    border: '1px solid rgba(139,92,246,0.25)',
    flexShrink: 0,
  },
  archiveBtn: {
    padding: '7px 14px',
    fontSize: 12,
    borderRadius: 6,
    background: 'rgba(139,92,246,0.08)',
    color: '#A78BFA',
    border: '1px solid rgba(139,92,246,0.25)',
    fontWeight: 500,
    cursor: 'pointer',
  },
};
