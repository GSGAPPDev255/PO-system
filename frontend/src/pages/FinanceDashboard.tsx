import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { useInvoices } from '../hooks/useInvoices';
import StatusBadge from '../components/shared/StatusBadge';
import { supabase } from '../lib/supabase';
import type { InvoiceStatus } from '../lib/supabase';

const STATUS_FILTERS: { label: string; value: InvoiceStatus | 'all' }[] = [
  { label: 'All',              value: 'all' },
  { label: 'Pending Review',   value: 'pending_finance_review' },
  { label: 'Pending Approval', value: 'pending_approval' },
  { label: 'Approved',         value: 'approved' },
  { label: 'Rejected',         value: 'rejected' },
  { label: 'Ready to Export',  value: 'approved_ready_export' },
  { label: 'Exported',         value: 'exported' },
];

function fmtDate(raw: string): string {
  try {
    const normalised = raw.replace(/(\.\d{3})\d+/, '$1');
    const d = parseISO(normalised);
    return isValid(d) ? format(d, 'dd MMM yyyy') : '—';
  } catch {
    return '—';
  }
}

function fmtMoney(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `£${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinanceDashboard() {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [companyFilters, setCompanyFilters] = useState<{ label: string; value: string }[]>([
    { label: 'All', value: 'all' },
  ]);
  const navigate = useNavigate();

  // Load companies dynamically from DB
  useEffect(() => {
    supabase
      .from('companies')
      .select('name, slug')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setCompanyFilters([
            { label: 'All', value: 'all' },
            ...data.map((c: { name: string; slug: string }) => ({ label: c.name, value: c.slug })),
          ]);
        }
      });
  }, []);

  const { data: invoices = [], isLoading, error } = useInvoices(
    statusFilter === 'all' ? undefined : statusFilter,
  );

  const filtered = useMemo(() => {
    let result = invoices;
    if (companyFilter !== 'all') {
      result = result.filter((i) => (i as unknown as Record<string, unknown>).company === companyFilter);
    }
    if (!search.trim()) return result;
    const q = search.trim().toLowerCase();
    return result.filter((i) =>
      (i.supplier_name ?? '').toLowerCase().includes(q) ||
      (i.transaction_reference ?? '').toLowerCase().includes(q) ||
      (i.account_number ?? '').toLowerCase().includes(q),
    );
  }, [invoices, search, companyFilter]);

  const totals = useMemo(() => {
    let gross = 0;
    let awaiting = 0;
    let awaitingApproval = 0;
    for (const i of invoices) {
      gross += Number(i.gross_amount ?? 0);
      if (i.status === 'pending_finance_review') awaiting++;
      if (i.status === 'pending_approval') awaitingApproval++;
    }
    return { gross, awaiting, awaitingApproval };
  }, [invoices]);

  if (error) {
    return (
      <div style={styles.errorBanner}>
        <span style={styles.errLabel}>Error</span>
        Failed to load invoices: {(error as Error).message}
      </div>
    );
  }

  return (
    <div>
      {/* Page header — editorial masthead */}
      <header style={styles.masthead} className="animate-rise">
        <div>
          <div style={styles.kicker}>
            <span style={styles.kickerRule} />
            The Ledger · {new Date().getFullYear()}
          </div>
          <h1 style={styles.pageTitle}>
            Invoice Dashboard
          </h1>
          <p style={styles.subtitle}>
            {filtered.length} record{filtered.length === 1 ? '' : 's'}
            {statusFilter !== 'all' && (
              <>
                {' '}·{' '}
                <em style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
                  filtered by {STATUS_FILTERS.find((f) => f.value === statusFilter)?.label.toLowerCase()}
                </em>
              </>
            )}
          </p>
        </div>
      </header>

      {/* Stat triptych */}
      <div style={styles.stats} className="animate-rise delay-1 stats-grid">
        <Stat
          label="Open Value"
          value={`£${totals.gross.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          caption={`across ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
          accent
        />
        <Stat
          label="Awaiting Finance"
          value={String(totals.awaiting)}
          caption={totals.awaiting === 1 ? 'needs review' : 'need review'}
        />
        <Stat
          label="With Approvers"
          value={String(totals.awaitingApproval)}
          caption={totals.awaitingApproval === 1 ? 'pending decision' : 'pending decisions'}
        />
      </div>

      {/* Filter + search row */}
      <div style={styles.controls} className="animate-rise delay-2 toolbar-row">

        {/* Company filter */}
        <div style={{ ...styles.tabs, marginBottom: 8 }} role="tablist" className="filter-chips">
          {companyFilters.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={companyFilter === f.value}
              style={{
                ...styles.tab,
                ...(companyFilter === f.value ? { ...styles.tabActive, background: 'var(--accent-3)', borderColor: 'var(--accent-3)' } : {}),
              }}
              onClick={() => setCompanyFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={styles.tabs} role="tablist" className="filter-chips">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={statusFilter === f.value}
              style={{
                ...styles.tab,
                ...(statusFilter === f.value ? styles.tabActive : {}),
              }}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ ...styles.searchWrap, width: '100%', maxWidth: 320 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" style={{ opacity: 0.5 }} aria-hidden>
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search supplier, ref…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={styles.empty}>
          <div style={styles.spinner} />
          <span>Loading records…</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={statusFilter} hasSearch={!!search.trim()} />
      ) : (
        <div className="animate-rise delay-3">
          {/* Desktop table */}
          <div style={styles.tableWrap} className="desktop-table table-scroll-wrapper">
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Supplier</th>
                  <th style={styles.th}>School</th>
                  <th style={styles.th}>Invoice Ref</th>
                  <th style={styles.th}>Invoice Date</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Gross</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Approver</th>
                  <th style={styles.th}>Received</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, idx) => {
                  const approver = inv.approver as { display_name?: string } | null;
                  const zebra = idx % 2 === 1;
                  return (
                    <tr
                      key={inv.id}
                      style={{ ...styles.row, ...(zebra ? styles.rowZebra : {}) }}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = zebra ? 'rgba(228,221,203,0.25)' : 'transparent'; }}
                    >
                      <td style={styles.td}>
                        <div style={styles.supplierName}>{inv.supplier_name ?? '—'}</div>
                        {inv.account_number && <div style={styles.accountNum}>{inv.account_number}</div>}
                      </td>
                      <td style={styles.td}>
                        <CompanyBadge company={(inv as unknown as Record<string, unknown>).company as string | null} />
                      </td>
                      <td style={{ ...styles.td, ...styles.mono }}>{inv.transaction_reference ?? <span style={styles.muted}>—</span>}</td>
                      <td style={styles.td}>{inv.transaction_date ? fmtDate(inv.transaction_date) : <span style={styles.muted}>—</span>}</td>
                      <td style={{ ...styles.td, ...styles.moneyCell }}>{fmtMoney(inv.gross_amount)}</td>
                      <td style={styles.td}><StatusBadge status={inv.status} /></td>
                      <td style={styles.td}>{approver?.display_name ? <span style={styles.approverName}>{approver.display_name}</span> : <span style={styles.unassigned}>— Unassigned</span>}</td>
                      <td style={{ ...styles.td, color: 'var(--ink-muted)' }}>{fmtDate(inv.created_at)}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button style={styles.rowBtnPrimary} onClick={() => navigate(`/invoices/${inv.id}`)}>Review <span style={{ opacity: 0.6 }}>→</span></button>
                        <button style={styles.rowBtn} onClick={() => navigate(`/audit/${inv.id}`)}>Audit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="mobile-cards" style={{ ...styles.tableWrap, display: 'none' }}>
            {filtered.map((inv) => {
              const approver = inv.approver as { display_name?: string } | null;
              return (
                <div key={inv.id} className="mobile-card-row" onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <div className="mobile-card-row-top">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{inv.supplier_name ?? '—'}</div>
                      {inv.transaction_reference && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{inv.transaction_reference}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{fmtMoney(inv.gross_amount)}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3 }}>{inv.transaction_date ? fmtDate(inv.transaction_date) : '—'}</div>
                    </div>
                  </div>
                  <div className="mobile-card-row-meta">
                    <StatusBadge status={inv.status} />
                    {approver?.display_name && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{approver.display_name}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Cycle through accent colours for any company slug
const BADGE_COLORS = ['#7b61ff', '#00b4d8', '#06d6a0', '#f4a261', '#e76f51', '#a8dadc'];
function companyColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
}

function CompanyBadge({ company, label }: { company: string | null; label?: string }) {
  if (!company) return <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>—</span>;
  const color = companyColor(company);
  const displayLabel = label ?? company.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      padding: '2px 8px', borderRadius: 20,
      background: `${color}22`, color, border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

function Stat({
  label, value, caption, accent,
}: { label: string; value: string; caption: string; accent?: boolean }) {
  return (
    <div style={{ ...statStyles.card, ...(accent ? statStyles.cardAccent : {}) }}>
      <div style={statStyles.label}>{label}</div>
      <div style={{ ...statStyles.value, ...(accent ? { color: 'var(--accent)' } : {}) }}>
        {value}
      </div>
      <div style={statStyles.caption}>{caption}</div>
    </div>
  );
}

function EmptyState({ filter, hasSearch }: { filter: InvoiceStatus | 'all'; hasSearch: boolean }) {
  return (
    <div style={styles.empty}>
      <div style={styles.emptyMark}>§</div>
      <div style={styles.emptyTitle}>Nothing here yet.</div>
      <div style={styles.emptyBody}>
        {hasSearch
          ? 'No records match your search.'
          : filter === 'all'
            ? 'Invoices will appear as emails are processed from the finance mailbox.'
            : 'No invoices in this state.'}
      </div>
    </div>
  );
}

const statStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '20px 22px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  cardAccent: {
    background: 'linear-gradient(180deg, #FAF7F0 0%, #F4E8DA 100%)',
    borderColor: 'rgba(181, 78, 28, 0.18)',
  },
  label: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
  },
  value: {
    fontFamily: 'var(--font-display)',
    fontSize: 34,
    fontWeight: 400,
    color: 'var(--ink)',
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    fontVariationSettings: "'opsz' 72, 'SOFT' 50",
  },
  caption: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
};

const styles: Record<string, React.CSSProperties> = {
  masthead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 28,
    borderBottom: '1px solid var(--line)',
    marginBottom: 28,
    gap: 20,
  },
  kicker: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    marginBottom: 14,
  },
  kickerRule: { width: 24, height: 1, background: 'var(--accent)' },
  pageTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(34px, 4vw, 46px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.02,
    fontVariationSettings: "'opsz' 144, 'SOFT' 30",
  },
  subtitle: {
    margin: '10px 0 0',
    fontSize: 14,
    color: 'var(--ink-muted)',
  },

  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 16,
    marginBottom: 28,
  },

  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 0,
    borderBottom: '1px solid var(--line)',
    flexWrap: 'wrap',
    rowGap: 0,
  },
  tab: {
    position: 'relative',
    padding: '10px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
    fontSize: 12.5,
    fontWeight: 500,
    color: 'var(--ink-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s var(--ease)',
    letterSpacing: '0.005em',
    whiteSpace: 'nowrap',
  },
  tabActive: {
    color: 'var(--ink)',
    borderBottomColor: 'var(--accent)',
    fontWeight: 600,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 999,
    minWidth: 280,
    color: 'var(--ink-muted)',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    padding: 0,
    fontSize: 13,
    width: '100%',
    color: 'var(--ink)',
  },

  tableWrap: {
    background: 'var(--paper-bright)',
    borderRadius: 10,
    border: '1px solid var(--line)',
    overflow: 'hidden',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '14px 18px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    borderBottom: '1px solid var(--line)',
    background: 'var(--paper)',
  },
  row: {
    cursor: 'pointer',
    transition: 'background 0.12s var(--ease)',
  },
  rowZebra: { background: 'rgba(228, 221, 203, 0.25)' },
  td: {
    padding: '14px 18px',
    fontSize: 13,
    borderBottom: '1px solid var(--line)',
    verticalAlign: 'middle',
    color: 'var(--ink)',
  },
  supplierName: { fontWeight: 600, color: 'var(--ink)', fontSize: 13.5 },
  accountNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--ink-faint)',
    marginTop: 3,
    letterSpacing: '0.02em',
  },
  mono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--ink-soft)',
  },
  moneyCell: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    fontWeight: 500,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--ink)',
  },
  approverName: { color: 'var(--ink)', fontWeight: 500 },
  unassigned: {
    color: 'var(--ink-faint)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  muted: { color: 'var(--ink-faint)' },

  rowBtnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 11.5,
    fontWeight: 500,
    border: '1px solid var(--ink)',
    background: 'var(--ink)',
    color: 'var(--paper)',
    borderRadius: 5,
    cursor: 'pointer',
    marginRight: 6,
    letterSpacing: '0.01em',
  },
  rowBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 11.5,
    fontWeight: 500,
    border: '1px solid var(--line-strong)',
    background: 'transparent',
    color: 'var(--ink-soft)',
    borderRadius: 5,
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },

  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '64px 24px',
    background: 'var(--paper-bright)',
    borderRadius: 10,
    border: '1px dashed var(--line-strong)',
    color: 'var(--ink-muted)',
    textAlign: 'center',
  },
  emptyMark: {
    fontFamily: 'var(--font-display)',
    fontSize: 48,
    color: 'var(--accent)',
    fontWeight: 400,
    lineHeight: 1,
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontStyle: 'italic',
    color: 'var(--ink-soft)',
    fontWeight: 400,
  },
  emptyBody: {
    fontSize: 13,
    color: 'var(--ink-muted)',
    maxWidth: 380,
    lineHeight: 1.5,
  },
  spinner: {
    width: 28, height: 28,
    border: '2.5px solid var(--line)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: 6,
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    padding: '14px 18px',
    background: 'var(--danger-soft)',
    border: '1px solid rgba(160, 49, 53, 0.25)',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--danger)',
  },
  errLabel: {
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
  },
};
