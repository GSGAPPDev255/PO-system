import type { Profile } from '../../lib/supabase';
import { signOut } from '../../lib/auth';

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

interface TopBarProps {
  profile: Profile;
  onMenuClick: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export default function TopBar({ profile, onMenuClick, isDark, onToggleTheme }: TopBarProps) {
  const today = LONG_DATE.format(new Date());

  return (
    <header style={styles.bar}>
      <div style={styles.prismLine} aria-hidden />

      <div style={styles.leftSide}>
        {/* Hamburger — hidden on desktop via CSS */}
        <button
          className="topbar-hamburger"
          style={styles.hamburger}
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <span style={styles.hamburgerLine} />
          <span style={styles.hamburgerLine} />
          <span style={styles.hamburgerLine} />
        </button>

        {/* Date badge — hidden on mobile via CSS */}
        <div className="topbar-date-badge" style={styles.dateBadge}>
          <span style={styles.dateLabel}>Today</span>
          <span style={styles.dateValue}>{today}</span>
        </div>
      </div>

      <div style={styles.rightSide}>
        {/* Theme toggle */}
        <button
          className="topbar-theme-toggle"
          style={styles.themeToggle}
          onClick={onToggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span style={{ ...styles.themeIcon, animation: 'theme-spin 0.3s var(--ease) both' }}
            key={isDark ? 'moon' : 'sun'}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </span>
          <span className="topbar-theme-label" style={styles.themeLabel}>
            {isDark ? 'Light' : 'Dark'}
          </span>
        </button>

        <div style={styles.user}>
          <div style={styles.userMeta}>
            <span style={styles.userName}>{profile.display_name}</span>
            <span style={styles.userRole}>{profile.role}</span>
          </div>
          <div style={styles.avatar} title={profile.display_name}>
            {initials(profile.display_name || profile.email)}
          </div>
        </div>

        <button style={styles.signOut} onClick={signOut}>
          <span className="topbar-sign-out-text">Sign out</span>
          <span className="topbar-sign-out-arrow" style={styles.signOutArrow} aria-hidden>→</span>
        </button>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 60,
    background: 'rgba(240, 244, 255, 0.92)',
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%)',
    backdropFilter: 'blur(32px) saturate(1.8)',
    WebkitBackdropFilter: 'blur(32px) saturate(1.8)',
    borderBottom: '2px solid rgba(0,180,216,0.14)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    boxShadow: 'inset 0 1px 0 rgba(0,180,216,0.08)',
  },
  prismLine: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 2,
    background: 'linear-gradient(90deg, transparent 0%, rgba(0,180,216,0.50) 18%, rgba(6,214,160,0.40) 45%, rgba(123,97,255,0.35) 72%, rgba(0,180,216,0.25) 100%)',
    boxShadow: '0 2px 16px rgba(0,180,216,0.18), inset 0 1px 0 rgba(255,255,255,0.3)',
  },
  leftSide: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  hamburger: {
    display: 'none',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 5,
    background: 'var(--topbar-btn-bg)',
    border: '1px solid var(--topbar-btn-border)',
    borderRadius: 8,
    padding: '7px 9px',
    cursor: 'pointer',
    width: 38,
    height: 38,
  },
  hamburgerLine: {
    display: 'block',
    width: 18,
    height: 1.5,
    background: 'var(--topbar-hamburger-line)',
    borderRadius: 2,
  },
  dateBadge: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 10,
  },
  dateLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--topbar-date-label)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    fontFamily: 'var(--font-display)',
  },
  dateValue: {
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    fontWeight: 300,
    color: 'var(--topbar-date-value)',
    letterSpacing: '0.01em',
  },
  rightSide: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    background: 'rgba(0,180,216,0.10)',
    border: '1px solid rgba(0,180,216,0.20)',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--accent)',
    transition: 'all 0.15s var(--ease)',
    flexShrink: 0,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    whiteSpace: 'nowrap' as const,
  },
  themeLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--accent)',
    letterSpacing: '0.04em',
    fontFamily: 'var(--font-ui)',
  },
  themeIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  user: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  userMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    lineHeight: 1.2,
  },
  userName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--topbar-user-name)',
  },
  userRole: {
    fontSize: 9,
    color: 'var(--topbar-user-role)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    marginTop: 2,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(0,180,216,0.25) 0%, rgba(6,214,160,0.25) 100%)',
    border: '1px solid rgba(0,180,216,0.30)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.05em',
    fontFamily: 'var(--font-display)',
    boxShadow: '0 0 10px rgba(0,180,216,0.15)',
    flexShrink: 0,
  },
  signOut: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    background: 'var(--topbar-btn-bg)',
    border: '1px solid var(--topbar-btn-border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--topbar-btn-color)',
    fontWeight: 400,
    transition: 'all 0.15s var(--ease)',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
  },
  signOutArrow: {
    fontSize: 14,
    color: 'var(--accent)',
    opacity: 0.7,
  },
};
