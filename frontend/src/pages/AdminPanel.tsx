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

type Tab = 'users' | 'approvers' | 'alerts' | 'system';

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
  { id: 'alerts',    number: '03', label: 'Alerts' },
  { id: 'system',    number: '04', label: 'System' },
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
          Users, approvers, alerts, and system health — all in one place.
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
        {tab === 'alerts'    && <AlertsTab />}
        {tab === 'system'    && <SystemTab />}
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

interface InviteForm { email: string; display_name: string; role: UserRole }
const EMPTY_INVITE: InviteForm = { email: '', display_name: '', role: 'finance' };

function UsersTab() {
  const [profiles, setProfiles]     = useState<Profile[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState<string | null>(null);
  const [msg, setMsg]               = useState('');
  const [msgType, setMsgType]       = useState<'success' | 'error'>('success');
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting]     = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE);

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('profiles').select('*').order('display_name');
      if (error) { setMsg('Could not load users: ' + error.message); setMsgType('error'); }
      setProfiles((data as Profile[]) ?? []);
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
              <th style={s.th}>Status</th>
              <th style={s.th}>Joined</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, idx) => (
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
                <td style={{ ...s.td, ...s.mono }}>{new Date(p.created_at).toLocaleDateString('en-GB')}</td>
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
            ))}
          </tbody>
        </table>
        {profiles.length === 0 && <div style={s.empty}>No users yet.</div>}
      </div>
    </div>
  );
}

// ─── Approvers Tab ────────────────────────────────────────────────────────────

interface GalUser {
  azure_oid: string;
  display_name: string;
  email: string;
  department: string | null;
  job_title: string | null;
}

function ApproversTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching]     = useState(false);
  const [galResults, setGalResults]   = useState<GalUser[] | null>(null);
  const [galError, setGalError]       = useState<string | null>(null);
  const [adding, setAdding]           = useState<string | null>(null);
  const [added, setAdded]             = useState<Set<string>>(new Set());

  const [showManual, setShowManual]     = useState(false);
  const [manualForm, setManualForm]     = useState({ display_name: '', email: '', department: '' });
  const [manualSaving, setManualSaving] = useState(false);

  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');

  function flash(m: string, type: 'success' | 'error' = 'success') {
    setMsg(m); setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  }

  async function searchGal() {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;
    setSearching(true);
    setGalResults(null);
    setGalError(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'search_gal', query: searchQuery.trim() },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setGalResults(data.users ?? []);
    } catch (e) {
      setGalError((e as Error).message);
    }
    setSearching(false);
  }

  async function addFromGal(user: GalUser) {
    setAdding(user.azure_oid);
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: {
          action:       'add_approver',
          azure_oid:    user.azure_oid,
          display_name: user.display_name,
          email:        user.email,
          department:   user.department,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      flash(`${user.display_name} added as approver.`);
      setAdded((prev) => new Set([...prev, user.azure_oid]));
    } catch (e) {
      flash('Error: ' + (e as Error).message, 'error');
    }
    setAdding(null);
  }

  async function addManual() {
    const { display_name, email, department } = manualForm;
    if (!display_name.trim() || !email.trim()) {
      flash('Name and email are required.', 'error'); return;
    }
    setManualSaving(true);
    const { error } = await supabase.from('approvers').insert({
      display_name: display_name.trim(),
      email:        email.trim().toLowerCase(),
      department:   department.trim() || null,
      is_active:    true,
      synced_at:    new Date().toISOString(),
    });
    if (error) flash('Error: ' + error.message, 'error');
    else {
      flash('Approver added.');
      setManualForm({ display_name: '', email: '', department: '' });
      setShowManual(false);
    }
    setManualSaving(false);
  }

  return (
    <div>
      <SectionHeader
        title="Approvers"
        subtitle="Search your Microsoft 365 directory and choose who can approve invoices and expenses."
        msg={msg}
        msgType={msgType}
        actions={
          <button className="btn" style={s.btnSecondary}
            onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Cancel' : '+ Add manually'}
          </button>
        }
      />

      {/* GAL Search panel */}
      <div style={ap.searchPanel}>
        <div style={ap.searchKicker}>§ Search Microsoft 365 directory</div>
        <div style={ap.searchTitle}>Find & add approvers</div>
        <div style={ap.searchSub}>
          Type a name or email to search your organisation's directory. Only individuals you select will be added.
        </div>
        <div style={ap.searchRow}>
          <input
            style={ap.searchInput}
            type="text"
            placeholder="e.g. Jane Smith or jane@school.com"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchGal()}
          />
          <button className="btn" style={s.btnPrimary} onClick={searchGal}
            disabled={searching || searchQuery.trim().length < 2}>
            {searching ? 'Searching…' : 'Search →'}
          </button>
        </div>

        {galError && (
          <div style={ap.galError}>
            <strong>Search failed:</strong> {galError}
            {galError.includes('Graph API') && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                Ensure Azure AD app has <code style={s.code}>User.Read.All</code> Application permission with admin consent.
              </div>
            )}
          </div>
        )}

        {galResults !== null && galResults.length === 0 && !galError && (
          <div style={ap.galEmpty}>No matching users found for "{searchQuery}"</div>
        )}

        {galResults && galResults.length > 0 && (
          <div style={ap.galResults}>
            <div style={ap.galResultsLabel}>{galResults.length} result{galResults.length !== 1 ? 's' : ''}</div>
            {galResults.map((user) => {
              const justAdded = added.has(user.azure_oid);
              return (
                <div key={user.azure_oid} style={ap.galRow}>
                  <div style={ap.galAvatar}>
                    {(user.display_name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div style={ap.galInfo}>
                    <div style={ap.galName}>{user.display_name}</div>
                    <div style={ap.galMeta}>
                      <span style={ap.galEmail}>{user.email}</span>
                      {user.department && <span style={ap.galDept}>· {user.department}</span>}
                      {user.job_title && <span style={ap.galDept}>· {user.job_title}</span>}
                    </div>
                  </div>
                  <div style={ap.galAction}>
                    {justAdded ? (
                      <span style={ap.alreadyAdded}>✓ Added</span>
                    ) : (
                      <button className="btn" style={ap.addBtn}
                        disabled={adding === user.azure_oid}
                        onClick={() => addFromGal(user)}>
                        {adding === user.azure_oid ? 'Adding…' : '+ Add'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Manual add form ── */}
      {showManual && (
        <div style={s.addForm} className="animate-rise">
          <div style={s.addFormKicker}>§ Manual approver</div>
          <div style={s.addFormTitle}>Add without Microsoft 365</div>
          <div style={s.addFormSub}>For external approvers not in your Azure AD directory.</div>
          <div style={{ ...s.formGrid, marginTop: 14 }}>
            <div style={s.formGroup}>
              <label style={s.label}>Full name *</label>
              <input style={s.input} value={manualForm.display_name} placeholder="e.g. Jane Smith"
                onChange={(e) => setManualForm({ ...manualForm, display_name: e.target.value })} />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Email address *</label>
              <input style={s.input} type="email" value={manualForm.email} placeholder="jane@example.com"
                onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })} />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Department</label>
              <input style={s.input} value={manualForm.department} placeholder="e.g. Finance"
                onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={s.btnPrimary} disabled={manualSaving} onClick={addManual}>
              {manualSaving ? 'Saving…' : 'Add approver →'}
            </button>
            <button className="btn" style={s.btnSecondary}
              onClick={() => { setShowManual(false); setManualForm({ display_name: '', email: '', department: '' }); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Approvers-tab-specific styles
const ap: Record<string, React.CSSProperties> = {
  searchPanel: {
    background: 'rgba(0,180,216,0.04)',
    border: '1px solid rgba(0,180,216,0.18)',
    borderRadius: 12,
    padding: '22px 24px',
    marginBottom: 18,
  },
  searchKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  searchTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 500,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
    marginBottom: 4,
  },
  searchSub: {
    fontSize: 12.5,
    color: 'var(--ink-muted)',
    marginBottom: 16,
    lineHeight: 1.5,
  },
  searchRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--line-strong)',
    fontSize: 13,
    background: 'var(--paper)',
    color: 'var(--ink)',
    outline: 'none',
  },
  galError: {
    marginTop: 14,
    padding: '12px 14px',
    background: 'var(--danger-soft)',
    border: '1px solid rgba(244,63,94,0.25)',
    borderRadius: 8,
    fontSize: 12.5,
    color: 'var(--danger)',
    lineHeight: 1.5,
  },
  galEmpty: {
    marginTop: 14,
    padding: '14px 16px',
    background: 'var(--paper-tint)',
    border: '1px dashed var(--line-strong)',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  galResults: {
    marginTop: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  galResultsLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.16em',
    marginBottom: 6,
    fontFamily: 'var(--font-display)',
  },
  galRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px 14px',
    borderRadius: 8,
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    transition: 'background 0.12s var(--ease)',
  },
  galAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(0,180,216,0.25) 0%, rgba(6,214,160,0.2) 100%)',
    border: '1px solid rgba(0,198,224,0.3)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    flexShrink: 0,
  },
  galInfo: {
    flex: 1,
    minWidth: 0,
  },
  galName: {
    fontSize: 13.5,
    fontWeight: 500,
    color: 'var(--ink)',
    marginBottom: 2,
  },
  galMeta: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  galEmail: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: 'var(--ink-muted)',
  },
  galDept: {
    fontSize: 11.5,
    color: 'var(--ink-faint)',
  },
  galAction: {
    flexShrink: 0,
  },
  addBtn: {
    padding: '6px 14px',
    fontSize: 12,
    borderRadius: 6,
    background: 'rgba(0,180,216,0.12)',
    color: 'var(--accent)',
    border: '1px solid rgba(0,198,224,0.3)',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s var(--ease)',
  },
  alreadyAdded: {
    fontSize: 12,
    color: 'var(--success)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    background: 'var(--success-soft)',
    borderRadius: 6,
    border: '1px solid rgba(16,185,129,0.2)',
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
