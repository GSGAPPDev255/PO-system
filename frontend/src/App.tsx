import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import type { Profile } from './lib/supabase';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import FinanceDashboard from './pages/FinanceDashboard';
import InvoiceReview from './pages/InvoiceReview';
import ApproverView from './pages/ApproverView';
import ExportManagement from './pages/ExportManagement';
import AuditTrailViewer from './pages/AuditTrailViewer';
import AdminPanel from './pages/AdminPanel';
import SpendingDashboard from './pages/SpendingDashboard';

const PROFILE_CACHE_KEY = 'posystem_profile_cache';

function getCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function setCachedProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch { /* storage full / private mode */ }
}

// ── Auth callback component ───────────────────────────────────────────────────
// Handles the PKCE exchange redirect from Microsoft/Supabase.
// - If the URL hash contains an error (e.g. expired client secret), surfaces it
//   and sends the user back to /login.
// - If profile resolves to null after auth, also returns to /login rather than
//   spinning forever.
function AuthCallback({ profile }: { profile: Profile | null | undefined }) {
  const location = useLocation();

  // Parse error params — Azure AD can return them in the hash (#error=...) OR
  // as query params (?error=...), so we check both.
  const hashParams   = new URLSearchParams(location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(location.search);
  const authError =
    hashParams.get('error_description')   ?? hashParams.get('error') ??
    searchParams.get('error_description') ?? searchParams.get('error');

  // Auth failed at provider level — send back to login with an error message.
  if (authError) {
    return <Navigate to="/login" state={{ authError }} replace />;
  }

  // Auth resolved and we have a profile → go to the app.
  if (profile) {
    return <Navigate to="/dashboard" replace />;
  }

  // Profile resolved to null (no profile row, or auth was rejected silently)
  // → return to login rather than spinning forever.
  if (profile === null) {
    return <Navigate to="/login" state={{ authError: 'Sign-in did not complete. Please try again.' }} replace />;
  }

  // profile === undefined → still waiting for Supabase to exchange the code.
  return (
    <div style={styles.center}>
      <div style={styles.spinner} />
      <span style={styles.spinnerLabel}>Signing in</span>
    </div>
  );
}

export default function App() {
  // Seed state from localStorage cache so the UI is instant on refresh.
  // `undefined` = still checking auth (show spinner).
  // `null`      = definitely not logged in (show login).
  // `Profile`   = logged in (show app).
  const [profile, setProfile] = useState<Profile | null | undefined>(() => {
    const cached = getCachedProfile();
    // If we have a cached profile start showing the app immediately;
    // auth validation happens in the background via onAuthStateChange.
    return cached ?? undefined;
  });

  const navigate = useNavigate();

  // ── Back-forward cache (bfcache) guard ───────────────────────────────────────
  // When the user signs out and the Azure logout page redirects them away, then
  // presses the browser's back button, some browsers restore the old page from
  // bfcache — React state (including `profile`) is still the signed-in state.
  // `pageshow` with `e.persisted=true` fires on bfcache restoration; we re-check
  // the session and clear state if the token is gone.
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
          try { localStorage.removeItem('posystem_profile_cache'); } catch { /* ignore */ }
          setProfile(null);
        }
      });
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    function applyProfile(p: Profile | null) {
      if (cancelled) return;
      setCachedProfile(p);
      setProfile(p);
    }

    function fetchProfile(userId: string) {
      // Supabase's query builder returns a PromiseLike (not a full Promise),
      // so .catch() isn't available — use the two-argument .then(onFulfilled, onRejected) form.
      supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .then(
          ({ data, error }) => {
            if (cancelled) return;
            if (error || !data) {
              console.warn('Profile load failed:', error?.message ?? 'no data');
              // Only clear profile/cache on definitive "not found" — not network errors
              applyProfile(null);
            } else {
              applyProfile(data as Profile);
            }
          },
          (err: unknown) => {
            // Network error: keep the cached profile rather than logging the user out.
            // The app will work with cached data; queries will fail gracefully.
            console.warn('Profile fetch network error — keeping cached state:', err);
            if (!cancelled) setProfile((prev) => (prev === undefined ? null : prev));
          },
        );
    }

    // Use getSession() for the page-refresh path instead of relying on
    // INITIAL_SESSION from onAuthStateChange. In Edge (and occasionally other
    // browsers) INITIAL_SESSION can fire before the auth token is fully
    // restored from storage, delivering a null session that overwrites the
    // profile cache and causes a redirect to /login.
    // getSession() reads directly from the in-memory session (already populated
    // from localStorage synchronously during Supabase client construction).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        // If there is a PKCE code in the URL we are mid-callback — the Supabase
        // client is still exchanging the code asynchronously.  Do NOT set profile
        // to null here; wait for the SIGNED_IN event from onAuthStateChange instead.
        const hasCallbackCode =
          new URLSearchParams(window.location.search).has('code') ||
          new URLSearchParams(window.location.hash.replace(/^#/, '')).has('access_token');
        if (!hasCallbackCode) {
          applyProfile(null);
        }
      }
    });

    // Only listen for subsequent auth transitions — skip INITIAL_SESSION entirely.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) fetchProfile(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          applyProfile(null);
          if (!cancelled) navigate('/login');
        }
      },
    );

    // Fallback: if profile is still undefined (no cache, auth slow) after 6s,
    // clear the spinner rather than hanging forever.
    const timeout = setTimeout(() => {
      if (!cancelled) setProfile((prev) => (prev === undefined ? null : prev));
    }, 6000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [navigate]);

  // Only show the full-page spinner if there is no cached profile AND auth
  // hasn't resolved yet. With a cache hit this state is skipped entirely.
  if (profile === undefined) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <span style={styles.spinnerLabel}>Loading</span>
      </div>
    );
  }

  return (
    <Routes>
      {/* Auth callback — detectSessionInUrl handles the PKCE exchange automatically */}
      <Route path="/auth/callback" element={<AuthCallback profile={profile} />} />

      {/* Public login */}
      <Route
        path="/login"
        element={
          profile
            ? <Navigate to="/dashboard" replace />
            : <Login />
        }
      />

      {/* Approver view — invoice */}
      <Route
        path="/approve/:id"
        element={
          profile ? (
            <AppShell profile={profile}>
              <ApproverView />
            </AppShell>
          ) : (
            <Navigate to="/login" state={{ returnTo: window.location.pathname }} replace />
          )
        }
      />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          profile ? (
            <AppShell profile={profile}>
              <Routes>
                {/* Root redirect */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />

                {/* ── Finance / admin / auditor routes ─────────────── */}
                <Route
                  path="/dashboard"
                  element={
                    profile?.role && ['finance', 'admin', 'auditor'].includes(profile.role)
                      ? <FinanceDashboard />
                      : <Navigate to="/login" replace />
                  }
                />
                <Route
                  path="/invoices/:id"
                  element={
                    profile?.role && ['finance', 'admin', 'auditor'].includes(profile.role)
                      ? <InvoiceReview />
                      : <Navigate to="/login" replace />
                  }
                />
                <Route
                  path="/export"
                  element={
                    profile?.role && ['finance', 'admin', 'auditor'].includes(profile.role)
                      ? <ExportManagement />
                      : <Navigate to="/login" replace />
                  }
                />
                <Route
                  path="/spend"
                  element={
                    profile?.role && ['finance', 'admin', 'auditor'].includes(profile.role)
                      ? <SpendingDashboard />
                      : <Navigate to="/login" replace />
                  }
                />
                <Route
                  path="/audit/:id"
                  element={
                    profile?.role && ['finance', 'admin', 'auditor'].includes(profile.role)
                      ? <AuditTrailViewer />
                      : <Navigate to="/login" replace />
                  }
                />
                <Route
                  path="/admin"
                  element={
                    profile?.role === 'admin'
                      ? <AdminPanel />
                      : <Navigate to="/dashboard" replace />
                  }
                />

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AppShell>
          ) : (
            <Navigate to="/login" state={{ returnTo: window.location.pathname }} replace />
          )
        }
      />
    </Routes>
  );
}


const styles: Record<string, React.CSSProperties> = {
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    height: '100vh',
    background: '#080e1c',
    position: 'relative',
    overflow: 'hidden',
  },
  spinner: {
    width: 52, height: 52,
    border: '2.5px solid rgba(0,180,216,0.15)',
    borderTopColor: '#00b4d8',
    borderRightColor: 'rgba(6,214,160,0.45)',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
  },
  spinnerLabel: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(240,244,255,0.35)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.2em',
  },
};
// Build trigger
