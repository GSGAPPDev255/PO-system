/**
 * AdminPanel — four tabs:
 *  1. Users      — view all profiles, invite new users, change roles, activate/deactivate
 *  2. Approvers  — search Azure AD to add approvers, or manually add external approvers
 *  3. Alerts     — configure CC emails, admin notification address
 *  4. System     — view function health, trigger email-intake manually
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../lib/supabase';

type Tab = 'users' | 'approvers' | 'companies' | 'alerts' | 'system';

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
  { id: 'companies', number: '03', label: 'Companies' },
  { id: 'alerts',    number: '04', label: 'Alerts' },
  { id: 'system',    number: '05', label: 'System' },
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

interface CompanyAccess { profile_id: string; company: string }

function UsersTab() {
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [companies, setCompanies]     = useState<{ slug: string; name: string }[]>([]);
  const [accessMap, setAccessMap]     = useState<Record<string, string[]>>({});  // profile_id → company slugs
  const [expandedAccess, setExpandedAccess] = useState<string | null>(null);  // profile_id being edited
  const [accessSaving, setAccessSaving]     = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);
  const [msg, setMsg]                 = useState('');
  const [msgType, setMsgType]         = useState<'success' | 'error'>('success');
  const [showInvite, setShowInvite]   = useState(false);
  const [inviting, setInviting]       = useState(false);
  const [inviteForm, setInviteForm]   = useState<InviteForm>(EMPTY_INVITE);

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, companiesRes, accessRes] = await Promise.all([
        supabase.from('profiles').select('*').order('display_name'),
        supabase.from('companies').select('slug, name').eq('is_active', true).order('name'),
        supabase.from('profile_company_access').select('profile_id, company'),
      ]);
      if (profilesRes.error) { setMsg('Could not load users: ' + profilesRes.error.message); setMsgType('error'); }
      setProfiles((profilesRes.data as Profile[]) ?? []);
      setCompanies((companiesRes.data as { slug: string; name: string }[]) ?? []);
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
      setShowInvite(false);
      await load();
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setInviting(false);
  }

  if (loading) return <div style={s.loading}>Loading users…</div>;

  return (
    <div>
      <SectionHeader
        title="System users"
        subtitle="All users who can sign in. Invite new staff, change roles, or deactivate accounts."
        msg={msg}
        msgType={msgType}
        actions={
          <button className="btn" style={s.btnPrimary} onClick={() => setShowInvite((v) => !v)}>
            {showInvite ? 'Cancel' : '+ Invite User'}
          </button>
        }
      />

      {showInvite && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New invite</div>
          <div style={s.addFormTitle}>Invite a new user</div>
          <div style={s.addFormSub}>
            They'll receive an email with a link to set a password and sign in.
          </div>
          <div style={{ ...s.formGrid, marginTop: 16 }}>
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
            <button className="btn" style={s.btnSecondary} onClick={() => { setShowInvite(false); setInviteForm(EMPTY_INVITE); }}>
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
            {profiles.map((p, idx) => {
              const userCompanies = accessMap[p.id] ?? [];
              const isFinance = p.role === 'finance';
              const isExpanded = expandedAccess === p.id;
              return (
                <>
                  <tr key={p.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}) }}>
                    <td style={s.td}><div style={s.name}>{p.display_name}</div></td>
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
                        <button
                          style={ua.accessChipAll}
                          onClick={() => setExpandedAccess(isExpanded ? null : p.id)}
                        >
                          All schools ↓
                        </button>
                      ) : (
                        <button
                          style={ua.accessChipLimited}
                          onClick={() => setExpandedAccess(isExpanded ? null : p.id)}
                        >
                          {userCompanies.length} school{userCompanies.length !== 1 ? 's' : ''} ↓
                        </button>
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span style={{
                          ...s.statusDot,
                          background: p.is_active ? 'var(--success)' : 'var(--ink-faint)',
                        }} />
                        <span style={{ fontSize: 12, color: p.is_active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
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
                          style={p.is_active ? s.btnDanger : s.btnSecondary}
                          disabled={saving === p.id}
                          onClick={() => toggleActive(p.id, p.is_active)}
                        >
                          {saving === p.id ? '…' : p.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>

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
                </>
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

interface CompanyOption { value: string; label: string }

function ApproversTab() {
  const [approvers, setApprovers]         = useState<Approver[]>([]);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([{ value: '', label: 'Group-wide (all companies)' }]);
  const [loading, setLoading]             = useState(true);
  const [showForm, setShowForm]           = useState(false);
  const [form, setForm]                   = useState({ display_name: '', email: '', department: '', company: '' });
  const [saving, setSaving]               = useState(false);
  const [toggling, setToggling]           = useState<string | null>(null);
  const [msg, setMsg]                     = useState('');
  const [msgType, setMsgType]             = useState<'success' | 'error'>('success');

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [approversRes, companiesRes] = await Promise.all([
      supabase.from('approvers').select('*').order('display_name'),
      supabase.from('companies').select('slug, name').eq('is_active', true).order('name'),
    ]);
    if (approversRes.error) flash('Could not load approvers: ' + approversRes.error.message, 'error');
    setApprovers((approversRes.data as Approver[]) ?? []);
    const opts: CompanyOption[] = [{ value: '', label: 'Group-wide (all companies)' }];
    for (const c of (companiesRes.data ?? []) as { slug: string; name: string }[]) {
      opts.push({ value: c.slug, label: c.name });
    }
    setCompanyOptions(opts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addApprover() {
    const { display_name, email, department, company } = form;
    if (!display_name.trim() || !email.trim()) {
      flash('Name and email are required.', 'error'); return;
    }
    setSaving(true);
    const { error } = await supabase.from('approvers').insert({
      display_name: display_name.trim(),
      email:        email.trim().toLowerCase(),
      department:   department.trim() || null,
      company:      company || null,
      is_active:    true,
      synced_at:    new Date().toISOString(),
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash(`${display_name.trim()} added as approver.`);
      setForm({ display_name: '', email: '', department: '', company: '' });
      setShowForm(false);
      await load();
    }
    setSaving(false);
  }

  async function toggleActive(approver: Approver) {
    setToggling(approver.id);
    const { error } = await supabase
      .from('approvers')
      .update({ is_active: !approver.is_active })
      .eq('id', approver.id);
    if (error) flash('Error: ' + error.message, 'error');
    else { flash(`${approver.display_name} ${approver.is_active ? 'deactivated' : 'activated'}.`); await load(); }
    setToggling(null);
  }

  return (
    <div>
      <SectionHeader
        title="Approvers"
        subtitle="Manage who can approve invoices. Add or deactivate approvers at any time."
        msg={msg}
        msgType={msgType}
        actions={
          <button className="btn" style={s.btnPrimary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add approver'}
          </button>
        }
      />

      {/* Add form */}
      {showForm && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ New approver</div>
          <div style={s.addFormTitle}>Add an approver</div>
          <div style={s.addFormSub}>They will receive approval request emails and can approve or reject invoices.</div>
          <div style={{ ...s.formGrid, marginTop: 14 }}>
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
            <div style={s.formGroup}>
              <label style={s.label}>Company *</label>
              <select style={s.input} value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}>
                {companyOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn" style={s.btnPrimary} disabled={saving} onClick={addApprover}>
              {saving ? 'Saving…' : 'Add approver →'}
            </button>
            <button className="btn" style={s.btnSecondary}
              onClick={() => { setShowForm(false); setForm({ display_name: '', email: '', department: '', company: '' }); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Approvers list */}
      <div style={s.card}>
        {loading ? (
          <div style={s.loading}>Loading approvers…</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>School</th>
                <th style={s.th}>Department</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvers.map((a, idx) => (
                <tr key={a.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}) }}>
                  <td style={s.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={ap.avatar}>{a.display_name.charAt(0).toUpperCase()}</div>
                      <div style={s.name}>{a.display_name}</div>
                    </div>
                  </td>
                  <td style={{ ...s.td, ...s.mono }}>{a.email}</td>
                  <td style={s.td}>
                    {a.company
                      ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)' }}>
                          {companyOptions.find((o) => o.value === a.company)?.label ?? a.company}
                        </span>
                      : <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(139,92,246,0.1)', color: '#A78BFA', border: '1px solid rgba(139,92,246,0.25)' }}>
                          Group-wide
                        </span>
                    }
                  </td>
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
                    <button
                      className="btn"
                      style={a.is_active ? s.btnDanger : s.btnSecondary}
                      disabled={toggling === a.id}
                      onClick={() => toggleActive(a)}
                    >
                      {toggling === a.id ? '…' : a.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && approvers.length === 0 && (
          <div style={s.empty}>No approvers yet. Add one above to get started.</div>
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
                          <th style={co.mth}>Status</th>
                          <th style={{ ...co.mth, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cMailboxes.map((m, idx) => (
                          <tr key={m.id} style={{ ...s.row, ...(idx % 2 === 1 ? s.rowAlt : {}), opacity: m.is_active ? 1 : 0.5 }}>
                            <td style={{ ...s.td, ...s.mono, fontSize: 12.5 }}>{m.email}</td>
                            <td style={{ ...s.td, fontSize: 13 }}>{m.label}</td>
                            <td style={s.td}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ ...s.statusDot, background: m.is_active ? 'var(--success)' : 'var(--ink-faint)' }} />
                                <span style={{ fontSize: 11.5 }}>{m.is_active ? 'Active' : 'Paused'}</span>
                              </span>
                            </td>
                            <td style={{ ...s.td, textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6 }}>
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
};

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

const ALERT_KEYS = ['alert_cc_emails', 'admin_alert_email', 'reminder_days', 'max_reminders'];

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
  { name: 'email-intake',       label: 'Email intake',        schedule: 'Every 5 minutes' },
  { name: 'reminder-scheduler', label: 'Reminder scheduler',  schedule: 'Daily · 08:00 UTC' },
  { name: 'gemini-processor',   label: 'Gemini processor',    schedule: 'On-demand' },
  { name: 'send-approval',      label: 'Send approval',       schedule: 'On-demand' },
  { name: 'process-approval',   label: 'Process approval',    schedule: 'On-demand' },
  { name: 'generate-csv',       label: 'Generate CSV',        schedule: 'On-demand' },
  { name: 'admin-actions',      label: 'Admin actions',       schedule: 'On-demand' },
];

function SystemTab() {
  const [triggering, setTriggering] = useState<string | null>(null);
  const [results, setResults]       = useState<Record<string, string>>({});
  const [stats, setStats]           = useState<{ pos: number; files: number; exports: number } | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);

  useEffect(() => {
    (async () => {
      const [posRes, filesRes, exportsRes] = await Promise.all([
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
        supabase.from('invoice_files').select('id', { count: 'exact', head: true }),
        supabase.from('csv_exports').select('id', { count: 'exact', head: true }),
      ]);
      setStats({
        pos:     posRes.count ?? 0,
        files:   filesRes.count ?? 0,
        exports: exportsRes.count ?? 0,
      });
    })();
  }, []);

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

  return (
    <div>
      <SectionHeader
        title="System health & controls"
        subtitle="Database stats and manual function triggers. Use these to test or recover from issues."
        actions={
          <button
            className="btn"
            style={s.btnPrimary}
            disabled={sendingReminders}
            onClick={sendManualReminders}
          >
            {sendingReminders ? 'Sending…' : '📧 Send reminders now'}
          </button>
        }
      />

      {stats && (
        <div style={s.statsRow}>
          <StatCard label="Invoice files" value={stats.files} />
          <StatCard label="Purchase orders" value={stats.pos} />
          <StatCard label="Sage exports" value={stats.exports} />
        </div>
      )}

      {results['manual-reminders'] && (
        <div style={{ ...s.card, marginBottom: 20, backgroundColor: 'var(--paper-bright)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: results['manual-reminders'].startsWith('Error') || results['manual-reminders'].startsWith('Failed') ? 'var(--danger)' : 'var(--success)' }}>
            {results['manual-reminders']}
          </div>
        </div>
      )}

      <div style={s.warningBox}>
        <div style={s.warningKicker}>§ Setup Required</div>
        <div style={s.warningTitle}>Email intake is returning errors</div>
        <div style={s.warningBody}>
          The <strong>email-intake</strong> and <strong>sync-approvers</strong> functions are failing because
          the Azure App Registration needs <strong>Application permissions</strong> (not just Delegated) for
          Microsoft Graph. Follow these steps to fix:
          <ol style={s.warningList}>
            <li>Open <strong>Azure Portal → App Registrations → your app → API Permissions</strong></li>
            <li>Click <strong>Add a permission → Microsoft Graph → Application permissions</strong></li>
            <li>Add: <code style={s.code}>Mail.ReadWrite</code> and <code style={s.code}>User.Read.All</code></li>
            <li>Click <strong>Grant admin consent</strong> (requires Azure AD Global Admin)</li>
            <li>Come back and click <strong>Run</strong> next to Email intake to test</li>
          </ol>
        </div>
      </div>

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
    gridTemplateColumns: 'repeat(3, 1fr)',
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

  warningBox: {
    background: 'var(--warning-soft)',
    border: '1px solid rgba(154, 107, 30, 0.3)',
    borderRadius: 10,
    padding: '20px 22px',
    marginBottom: 18,
  },
  warningKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--warning)',
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  warningTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--warning)',
    marginBottom: 10,
    letterSpacing: '-0.01em',
  },
  warningBody: {
    fontSize: 13,
    color: 'var(--warning)',
    lineHeight: 1.65,
  },
  warningList: {
    marginTop: 10,
    paddingLeft: 20,
    lineHeight: 1.8,
  },
  code: {
    background: 'rgba(154, 107, 30, 0.12)',
    padding: '1px 7px',
    borderRadius: 4,
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
  },
};
