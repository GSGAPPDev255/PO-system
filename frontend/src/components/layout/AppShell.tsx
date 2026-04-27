import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Profile } from '../../lib/supabase';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useTheme } from '../../hooks/useTheme';

interface AppShellProps {
  profile: Profile;
  children: ReactNode;
}

export default function AppShell({ profile, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar  = useCallback(() => setSidebarOpen(true),  []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const { isDark, toggleTheme } = useTheme();

  return (
    <div style={styles.shell}>
      {/* Ambient prism orbs — decorative */}
      <div style={{ ...styles.orb, ...styles.orbTL }} aria-hidden />
      <div style={{ ...styles.orb, ...styles.orbBR }} aria-hidden />

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          style={styles.overlay}
          onClick={closeSidebar}
          aria-hidden
        />
      )}

      <Sidebar role={profile.role} isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="app-shell-main" style={styles.main}>
        <TopBar
          profile={profile}
          onMenuClick={openSidebar}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
        <main style={styles.content}>
          <div className="app-content-inner" style={styles.inner}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--paper)',
    position: 'relative',
    backgroundImage: 'radial-gradient(ellipse 100% 80% at 50% 0%, rgba(0,180,216,0.08) 0%, transparent 50%)',
  },
  orb: {
    position: 'fixed',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: 0,
    filter: 'blur(40px)',
  },
  orbTL: {
    top: -200, left: -100,
    width: 700, height: 700,
    background: 'radial-gradient(circle, rgba(0,180,216,0.15) 0%, rgba(0,180,216,0.05) 45%, transparent 75%)',
  },
  orbBR: {
    bottom: -200, right: -100,
    width: 600, height: 600,
    background: 'radial-gradient(circle, rgba(6,214,160,0.12) 0%, rgba(6,214,160,0.04) 50%, transparent 75%)',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
    zIndex: 200,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
    position: 'relative',
    zIndex: 1,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    background: 'transparent',
  },
  inner: {
    maxWidth: 1400,
    margin: '0 auto',
    padding: '32px 40px 56px',
  },
};
