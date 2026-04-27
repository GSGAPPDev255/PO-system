import { NavLink } from 'react-router-dom';
import type { UserRole } from '../../lib/supabase';

interface NavItem {
  label: string;
  path: string;
  roles: UserRole[];
  number: string;
  section?: 'invoices' | 'expenses' | 'system';
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  // ── Invoice section ──────────────────────────────────────────────────────
  {
    number: '01', label: 'Dashboard',   path: '/dashboard',
    roles: ['finance', 'admin', 'auditor'],
    section: 'invoices',
    icon: <GridIcon />,
  },
  {
    number: '02', label: 'Export',      path: '/export',
    roles: ['finance', 'admin'],
    section: 'invoices',
    icon: <ExportIcon />,
  },
  // ── Expense section ──────────────────────────────────────────────────────
  {
    number: '03', label: 'Expenses',    path: '/expenses',
    roles: ['finance', 'admin', 'auditor'],
    section: 'expenses',
    icon: <ReceiptIcon />,
  },
  {
    number: '04', label: 'Exp. Export', path: '/expenses/export',
    roles: ['finance', 'admin'],
    section: 'expenses',
    icon: <ExportIcon />,
  },
  // ── System ───────────────────────────────────────────────────────────────
  {
    number: '05', label: 'Admin',       path: '/admin',
    roles: ['admin'],
    section: 'system',
    icon: <AdminIcon />,
  },
  // ── Staff-only ───────────────────────────────────────────────────────────
  {
    number: '01', label: 'My Expenses', path: '/my-expenses',
    roles: ['staff'],
    section: 'expenses',
    icon: <ReceiptIcon />,
  },
];

const SECTION_META: Record<string, { label: string; accent: string }> = {
  invoices: { label: 'Invoices',  accent: '#00B4D8' },
  expenses: { label: 'Expenses',  accent: '#06D6A0' },
  system:   { label: 'System',    accent: 'var(--ink-faint)' },
};

// ── Icon components ──────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function SotaraInfinityMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00B4D8" />
          <stop offset="100%" stopColor="#06D6A0" />
        </linearGradient>
      </defs>
      <path
        d="M50 30 C50 30 38 10 22 10 C10 10 2 18 2 30 C2 42 10 50 22 50 C38 50 50 30 50 30 Z"
        stroke="url(#sb-grad)" strokeWidth="7" strokeLinecap="round" fill="none"
      />
      <path
        d="M50 30 C50 30 62 50 78 50 C90 50 98 42 98 30 C98 18 90 10 78 10 C62 10 50 30 50 30 Z"
        stroke="url(#sb-grad)" strokeWidth="7" strokeLinecap="round" fill="none"
      />
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface SidebarProps {
  role: UserRole;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ role, isOpen, onClose }: SidebarProps) {
  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));

  // Group items by section
  const sections = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    const key = item.section ?? 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const isStaff = role === 'staff';

  return (
    <aside
      className={`sidebar-drawer${isOpen ? ' sidebar-open' : ''}`}
      style={styles.sidebar}
    >
      {/* Glow orb */}
      <div style={styles.glowOrb} aria-hidden />
      <div style={styles.glowOrb2} aria-hidden />

      {/* Mobile close button */}
      <button
        className="sidebar-close-btn"
        style={styles.closeBtn}
        onClick={onClose}
        aria-label="Close menu"
      >
        ✕
      </button>

      {/* Brand */}
      <div style={styles.brand}>
        <SotaraInfinityMark size={42} />
        <div>
          <div style={styles.brandWordmark}>SOTARA</div>
          <div style={styles.brandSub}>
            {isStaff ? 'Expense Portal' : 'Finance Platform'}
          </div>
        </div>
      </div>

      {/* Prism divider */}
      <div style={styles.prismDivider} aria-hidden />

      {/* Nav sections */}
      <nav style={styles.nav}>
        {Object.entries(sections).map(([sectionKey, sectionItems]) => {
          const meta = SECTION_META[sectionKey];
          return (
            <div key={sectionKey} style={styles.section}>
              {/* Section label — only show for non-staff with multiple sections */}
              {!isStaff && Object.keys(sections).length > 1 && meta && (
                <div style={styles.sectionLabel}>
                  <span style={{
                    ...styles.sectionDot,
                    background: meta.accent,
                    boxShadow: `0 0 6px ${meta.accent}`,
                  }} />
                  <span style={{ color: meta.accent }}>{meta.label}</span>
                </div>
              )}
              {sectionItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  style={({ isActive }) => ({
                    ...styles.navItem,
                    ...(isActive ? {
                      ...styles.navItemActive,
                      '--nav-accent': meta?.accent ?? 'var(--accent)',
                    } as React.CSSProperties : {}),
                  })}
                >
                  {({ isActive }) => (
                    <>
                      <span style={{
                        ...styles.navIcon,
                        color: isActive ? (meta?.accent ?? 'var(--accent)') : undefined,
                      }}>
                        {item.icon}
                      </span>
                      <span style={styles.navLabel}>{item.label}</span>
                      <span style={{
                        ...styles.navNumber,
                        ...(isActive ? {
                          background: `linear-gradient(135deg, ${meta?.accent ?? '#00B4D8'} 0%, #06D6A0 100%)`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          backgroundClip: 'text',
                        } : {}),
                      }}>
                        {item.number}
                      </span>
                      {isActive && (
                        <span style={{
                          ...styles.navPip,
                          background: meta?.accent ?? 'var(--accent)',
                          boxShadow: `0 0 8px ${meta?.accent ?? 'var(--accent)'}`,
                        }} aria-hidden />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={styles.footer}>
        <div style={styles.footerPrism} aria-hidden />
        <div style={styles.footerContent}>
          <div style={styles.footerLogoWrap}>
            <SotaraInfinityMark size={22} />
          </div>
          <div style={styles.footerRight}>
            <div style={styles.footerPlatform}>
              {isStaff ? 'Staff Portal' : 'Invoices & Expenses'}
            </div>
            <div style={styles.footerCopyright}>Sotara · Finance</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 230,
    background: 'var(--nav-bg)',
    backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%)',
    backdropFilter: 'blur(32px) saturate(2)',
    WebkitBackdropFilter: 'blur(32px) saturate(2)',
    color: 'var(--ink-soft)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    position: 'relative',
    borderRight: '2px solid var(--nav-border)',
    overflow: 'hidden',
    boxShadow: 'inset -1px 0 0 rgba(0,180,216,0.08)',
  },
  glowOrb: {
    position: 'absolute',
    top: -80, left: -60,
    width: 300, height: 300,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,180,216,0.20) 0%, rgba(0,180,216,0.08) 40%, transparent 70%)',
    pointerEvents: 'none',
    filter: 'blur(30px)',
  },
  glowOrb2: {
    position: 'absolute',
    bottom: 20, right: -80,
    width: 240, height: 240,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(6,214,160,0.15) 0%, rgba(6,214,160,0.05) 45%, transparent 75%)',
    pointerEvents: 'none',
    filter: 'blur(35px)',
  },
  closeBtn: {
    display: 'none',
    position: 'absolute',
    top: 14, right: 14,
    background: 'var(--nav-close-bg)',
    border: '1px solid var(--nav-close-border)',
    borderRadius: 8,
    color: 'var(--nav-close-color)',
    width: 32, height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    cursor: 'pointer',
    zIndex: 1,
  },
  brand: {
    padding: '26px 20px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    position: 'relative',
    zIndex: 1,
  },
  brandWordmark: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '0.2em',
    background: 'linear-gradient(135deg, #00B4D8 0%, #06D6A0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    lineHeight: 1.1,
  },
  brandSub: {
    fontSize: 9,
    fontWeight: 600,
    color: 'var(--nav-brand-sub)',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
    fontFamily: 'var(--font-display)',
    marginTop: 3,
  },
  prismDivider: {
    height: 2,
    margin: '0 20px',
    background: 'linear-gradient(90deg, transparent 0%, rgba(0,180,216,0.55) 25%, rgba(6,214,160,0.45) 50%, rgba(123,97,255,0.35) 75%, transparent 100%)',
    position: 'relative',
    zIndex: 1,
    boxShadow: '0 0 12px rgba(0,180,216,0.20), 0 0 24px rgba(6,214,160,0.12)',
  },
  nav: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    position: 'relative',
    zIndex: 1,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    marginBottom: 6,
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '12px 14px 6px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    fontFamily: 'var(--font-display)',
  },
  sectionDot: {
    width: 5, height: 5,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-block',
  },
  navItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    color: 'var(--nav-text)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 400,
    borderRadius: 9,
    transition: 'all 0.18s var(--ease)',
    letterSpacing: '0.01em',
  },
  navItemActive: {
    color: 'var(--nav-text-active)',
    background: 'rgba(0,180,216,0.15)',
    border: '1px solid rgba(0,180,216,0.22)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 0 16px rgba(0,180,216,0.12)',
  },
  navIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    flexShrink: 0,
    color: 'var(--nav-icon)',
    transition: 'color 0.18s var(--ease)',
  },
  navLabel: {
    flex: 1,
    fontWeight: 450,
  },
  navNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--nav-number)',
    fontWeight: 500,
    letterSpacing: '0.06em',
  },
  navPip: {
    width: 5, height: 5,
    borderRadius: '50%',
    flexShrink: 0,
  },

  footer: {
    position: 'relative',
    zIndex: 1,
    borderTop: '1px solid var(--nav-footer-border)',
    overflow: 'hidden',
  },
  footerPrism: {
    height: 2,
    background: 'linear-gradient(90deg, transparent 0%, rgba(0,180,216,0.30) 30%, rgba(6,214,160,0.22) 60%, transparent 100%)',
    boxShadow: '0 -2px 12px rgba(0,180,216,0.12)',
  },
  footerContent: {
    padding: '14px 18px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  footerLogoWrap: {
    opacity: 0.5,
    flexShrink: 0,
  },
  footerRight: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  footerPlatform: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--nav-footer-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontFamily: 'var(--font-display)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  footerCopyright: {
    fontSize: 9,
    color: 'var(--nav-footer-copy)',
    letterSpacing: '0.12em',
    fontFamily: 'var(--font-display)',
    textTransform: 'uppercase',
  },
};
