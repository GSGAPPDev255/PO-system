import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { signInWithAzureAD } from '../lib/auth';

export default function Login() {
  const location = useLocation();
  const navState = location.state as { authError?: string } | null;

  const [loading, setLoading] = useState(false);
  // Pre-populate error from navigation state (e.g. redirected back from auth callback).
  const [error, setError] = useState<string | null>(navState?.authError ?? null);

  // Safety net: if the browser doesn't navigate away within 25 s, drop the
  // overlay and show an actionable error rather than spinning forever.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setLoading(false);
      setError('Sign-in timed out — the Microsoft redirect did not complete. Please try again or contact the finance team.');
    }, 25_000);
    return () => clearTimeout(t);
  }, [loading]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithAzureAD();
      // signInWithOAuth triggers a browser redirect — execution should never
      // reach here in normal operation. The useEffect timeout above handles
      // the case where the redirect is silently blocked or fails.
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>

      {/* ── Full-page redirect overlay ─────────────────────────────────────── */}
      {loading && (
        <div style={styles.redirectOverlay}>
          <div style={styles.redirectCard}>
            {/* Prism top border */}
            <div style={styles.redirectPrismBorder} aria-hidden />
            <div style={styles.redirectInner}>
              {/* Branded spinner ring with logo centred inside */}
              <div style={styles.redirectSpinWrap}>
                <div style={styles.redirectRing} />
                <div style={styles.redirectRingInner}>
                  <SotaraInfinityMark size={32} />
                </div>
              </div>
              <div style={styles.redirectTitle}>Redirecting to Microsoft</div>
              <div style={styles.redirectSub}>
                Connecting to your Microsoft 365 account…
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ambient background orbs */}
      <div style={styles.orb1} aria-hidden />
      <div style={styles.orb2} aria-hidden />
      <div style={styles.orb3} aria-hidden />

      {/* Left — brand + feature showcase */}
      <div style={styles.left}>
        <div style={styles.leftInner}>

          {/* Logo lockup */}
          <div style={styles.logoBlock} className="animate-rise">
            <SotaraInfinityMark size={52} />
            <div style={styles.logoText}>
              <div style={styles.logoWordmark}>SOTARA</div>
              <div style={styles.logoTagline}>Finance Operations Platform</div>
            </div>
          </div>

          {/* Hero headline */}
          <div style={styles.heroBlock} className="animate-rise delay-1">
            <div style={styles.eyebrow}>
              <span style={styles.eyebrowPip} />
              Internal Finance Portal
            </div>
            <h1 style={styles.heroHeadline}>
              One platform.<br />
              <span style={styles.heroGradientText}>Every pound accounted for.</span>
            </h1>
            <p style={styles.heroLede}>
              Supplier invoices, end to end — AI-assisted extraction,
              structured review, and clean Sage exports. All in one place.
            </p>
          </div>

          {/* Feature pillar */}
          <div style={styles.pillarsRow} className="animate-rise delay-2">
            <PillarCard
              icon={<InvoiceIcon />}
              accent="#00B4D8"
              label="Invoices"
              description="Email intake → AI extraction → Finance review → Approver sign-off → Sage export"
            />
          </div>

          {/* Bottom metrics strip */}
          <div style={styles.metricsStrip} className="animate-rise delay-3">
            <Stat value="AI" label="OCR extraction" />
            <div style={styles.statDivider} />
            <Stat value="AD" label="Azure SSO auth" />
            <div style={styles.statDivider} />
            <Stat value="CSV" label="GL export" />
            <div style={styles.statDivider} />
            <Stat value="∞" label="Full audit trail" />
          </div>
        </div>
      </div>

      {/* Right — sign-in glass card */}
      <div style={styles.right}>
        <div style={styles.glassCard} className="animate-rise delay-2">
          {/* Prism top border */}
          <div style={styles.cardPrismBorder} aria-hidden />

          <div style={styles.cardInner}>
            <div style={styles.cardLogoMobile}>
              <SotaraInfinityMark size={36} />
              <span style={styles.cardLogoText}>SOTARA</span>
            </div>

            <div style={styles.cardKicker}>§ Secure Sign-in</div>
            <h2 style={styles.cardTitle}>Welcome back.</h2>
            <p style={styles.cardBody}>
              Authenticate with your Microsoft 365 account. Access level is
              automatically determined by your assigned role.
            </p>

            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorLabel}>Error</span>
                <span style={styles.errorMsg}>{error}</span>
              </div>
            )}

            <button
              style={{
                ...styles.loginBtn,
                ...(loading ? { opacity: 0.65, cursor: 'wait' } : {}),
              }}
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span style={styles.spinner} />
                  Redirecting to Microsoft…
                </>
              ) : (
                <>
                  <MicrosoftTiles />
                  Continue with Microsoft 365
                </>
              )}
            </button>

            {/* Role access info */}
            <div style={styles.rolesBlock}>
              <div style={styles.rolesLabel}>Who can sign in</div>
              <div style={styles.rolesList}>
                <RoleChip label="Finance" color="#00B4D8" />
                <RoleChip label="Approver" color="#7B61FF" />
                <RoleChip label="Staff" color="#06D6A0" />
                <RoleChip label="Auditor" color="#F59E0B" />
                <RoleChip label="Admin" color="#F43F5E" />
              </div>
            </div>

            <div style={styles.cardFoot}>
              <span style={styles.cardFootDot} />
              No password required — SSO only
              <span style={styles.cardFootDot} />
            </div>
          </div>
        </div>

        <div style={styles.helpText}>
          Trouble signing in?{' '}
          <span style={styles.helpLink}>Contact the finance team.</span>
        </div>

        {/* Emergency escape hatch — clears ALL Supabase + app session data and
            does a hard reload. Useful when a stale or corrupted session prevents
            login from completing. */}
        <button
          style={styles.clearBtn}
          onClick={() => {
            try { localStorage.clear(); } catch { /* ignore */ }
            try { sessionStorage.clear(); } catch { /* ignore */ }
            // Use assign (not reload) so any error params in the URL are dropped too.
            window.location.assign('/login');
          }}
          title="Clears all cached session data and reloads the page"
        >
          Clear session &amp; reload
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SotaraInfinityMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="login-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00B4D8" />
          <stop offset="100%" stopColor="#06D6A0" />
        </linearGradient>
        <filter id="login-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path
        d="M50 30 C50 30 38 10 22 10 C10 10 2 18 2 30 C2 42 10 50 22 50 C38 50 50 30 50 30 Z"
        stroke="url(#login-grad)" strokeWidth="7" strokeLinecap="round" fill="none" filter="url(#login-glow)"
      />
      <path
        d="M50 30 C50 30 62 50 78 50 C90 50 98 42 98 30 C98 18 90 10 78 10 C62 10 50 30 50 30 Z"
        stroke="url(#login-grad)" strokeWidth="7" strokeLinecap="round" fill="none" filter="url(#login-glow)"
      />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14,2 14,8 20,8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10,9 9,9 8,9"/>
    </svg>
  );
}

function PillarCard({ icon, accent, label, description }: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  description: string;
}) {
  return (
    <div style={{
      ...styles.pillar,
      borderColor: `${accent}22`,
    }}>
      <div style={{
        ...styles.pillarIconWrap,
        background: `${accent}15`,
        color: accent,
        boxShadow: `0 0 16px ${accent}25`,
      }}>
        {icon}
      </div>
      <div style={{ ...styles.pillarLabel, color: accent }}>{label}</div>
      <div style={styles.pillarDesc}>{description}</div>
      <div style={{
        ...styles.pillarGlow,
        background: `radial-gradient(ellipse at top left, ${accent}12 0%, transparent 65%)`,
      }} aria-hidden />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function RoleChip({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      ...styles.roleChip,
      background: `${color}12`,
      borderColor: `${color}30`,
      color,
    }}>
      {label}
    </div>
  );
}

function MicrosoftTiles() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
      <rect x="0" y="0" width="7" height="7" fill="#F25022" />
      <rect x="9" y="0" width="7" height="7" fill="#7FBA00" />
      <rect x="0" y="9" width="7" height="7" fill="#00A4EF" />
      <rect x="9" y="9" width="7" height="7" fill="#FFB900" />
    </svg>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
    background: 'var(--paper)',
    position: 'relative',
    overflow: 'hidden',
  },

  /* Ambient orbs */
  orb1: {
    position: 'fixed',
    top: '-15%', left: '-10%',
    width: '55vw', height: '55vw',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,180,216,0.10) 0%, transparent 65%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  orb2: {
    position: 'fixed',
    bottom: '-20%', right: '-5%',
    width: '45vw', height: '45vw',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(6,214,160,0.08) 0%, transparent 65%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  orb3: {
    position: 'fixed',
    top: '40%', left: '35%',
    width: '30vw', height: '30vw',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(123,97,255,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },

  /* Left panel */
  left: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '52px 64px 48px',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)',
    backdropFilter: 'blur(2px)',
  },
  leftInner: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: 44,
    maxWidth: 620,
  },

  /* Logo */
  logoBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logoText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  logoWordmark: {
    fontFamily: 'var(--font-display)',
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: '0.2em',
    background: 'linear-gradient(135deg, #00B4D8 0%, #06D6A0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    lineHeight: 1,
  },
  logoTagline: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(240,244,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    fontFamily: 'var(--font-display)',
  },

  /* Hero */
  heroBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(0,198,224,0.8)',
    textTransform: 'uppercase',
    letterSpacing: '0.25em',
  },
  eyebrowPip: {
    display: 'inline-block',
    width: 6, height: 6,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #00B4D8, #06D6A0)',
    boxShadow: '0 0 8px rgba(0,198,224,0.8)',
    flexShrink: 0,
  },
  heroHeadline: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 4.5vw, 62px)',
    fontWeight: 600,
    lineHeight: 1.08,
    letterSpacing: '-0.025em',
    color: 'var(--ink)',
  },
  heroGradientText: {
    background: 'linear-gradient(135deg, #00B4D8 0%, #06D6A0 50%, #7B61FF 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  heroLede: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.65,
    color: 'var(--ink-muted)',
    maxWidth: 500,
  },

  /* Pillar cards */
  pillarsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  pillar: {
    position: 'relative',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid',
    borderRadius: 14,
    padding: '22px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    backdropFilter: 'blur(12px)',
    overflow: 'hidden',
  },
  pillarIconWrap: {
    width: 44, height: 44,
    borderRadius: 10,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    marginBottom: 2,
  },
  pillarLabel: {
    fontFamily: 'var(--font-display)',
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    lineHeight: 1,
  },
  pillarDesc: {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'rgba(240,244,255,0.45)',
  },
  pillarGlow: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
  },

  /* Metrics strip */
  metricsStrip: {
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '20px 24px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    backdropFilter: 'blur(8px)',
  },
  stat: {
    flex: 1,
    textAlign: 'center',
    padding: '0 8px',
  },
  statValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    fontWeight: 700,
    background: 'linear-gradient(135deg, #00B4D8 0%, #06D6A0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    letterSpacing: '0.02em',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(240,244,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
  },
  statDivider: {
    width: 1,
    height: 32,
    background: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  },

  /* Right panel */
  right: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 56px',
    gap: 20,
  },
  glassCard: {
    width: '100%',
    maxWidth: 420,
    background: 'rgba(255,255,255,0.055)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 20,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
    backdropFilter: 'blur(24px) saturate(1.6)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
    position: 'relative',
    overflow: 'hidden',
  },
  cardPrismBorder: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 2,
    background: 'linear-gradient(90deg, transparent 0%, #00B4D8 30%, #06D6A0 65%, #7B61FF 85%, transparent 100%)',
    opacity: 0.8,
  },
  cardInner: {
    padding: '36px 36px 30px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  cardLogoMobile: {
    display: 'none', // shown on mobile via CSS
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  cardLogoText: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '0.18em',
    background: 'linear-gradient(135deg, #00B4D8 0%, #06D6A0 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  cardKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'rgba(0,198,224,0.7)',
    fontWeight: 600,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  cardTitle: {
    margin: '0 0 10px',
    fontFamily: 'var(--font-display)',
    fontSize: 32,
    fontWeight: 600,
    color: 'var(--ink)',
    letterSpacing: '-0.02em',
    lineHeight: 1.05,
  },
  cardBody: {
    margin: '0 0 24px',
    fontSize: 13,
    lineHeight: 1.65,
    color: 'var(--ink-muted)',
  },

  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '12px 14px',
    background: 'rgba(244,63,94,0.08)',
    border: '1px solid rgba(244,63,94,0.25)',
    borderRadius: 8,
    marginBottom: 16,
  },
  errorLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--danger)',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
  },
  errorMsg: {
    fontSize: 12.5,
    color: 'var(--danger)',
    lineHeight: 1.5,
  },

  loginBtn: {
    width: '100%',
    padding: '14px 20px',
    background: 'linear-gradient(135deg, rgba(0,180,216,0.18) 0%, rgba(6,214,160,0.14) 100%)',
    color: 'var(--ink)',
    border: '1px solid rgba(0,198,224,0.35)',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.01em',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    cursor: 'pointer',
    transition: 'all 0.18s var(--ease)',
    boxShadow: '0 4px 16px rgba(0,198,224,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
    backdropFilter: 'blur(8px)',
    fontFamily: 'var(--font-ui)',
    marginBottom: 22,
  },
  spinner: {
    width: 14, height: 14,
    border: '2px solid rgba(240,244,255,0.2)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  rolesBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '16px 18px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    marginBottom: 20,
  },
  rolesLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(240,244,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
    fontFamily: 'var(--font-display)',
    marginBottom: 2,
  },
  rolesList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleChip: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 20,
    border: '1px solid',
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.06em',
  },

  cardFoot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 18,
    borderTop: '1px solid rgba(255,255,255,0.07)',
    fontSize: 11,
    color: 'rgba(240,244,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
  },
  cardFootDot: {
    display: 'inline-block',
    width: 3, height: 3,
    borderRadius: '50%',
    background: 'rgba(0,198,224,0.5)',
  },

  helpText: {
    fontSize: 12,
    color: 'rgba(240,244,255,0.3)',
    textAlign: 'center',
  },
  helpLink: {
    color: 'rgba(0,198,224,0.6)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  clearBtn: {
    marginTop: 2,
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 11,
    color: 'rgba(240,244,255,0.18)',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    letterSpacing: '0.03em',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted' as const,
    textUnderlineOffset: 3,
  },

  /* ── Redirect overlay ────────────────────────────────────────────────────── */
  redirectOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(5,10,24,0.82)',
    backdropFilter: 'blur(18px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
  },
  redirectCard: {
    position: 'relative',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 20,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
    overflow: 'hidden',
    minWidth: 300,
  },
  redirectPrismBorder: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 2,
    background: 'linear-gradient(90deg, transparent 0%, #00B4D8 30%, #06D6A0 65%, #7B61FF 85%, transparent 100%)',
    opacity: 0.9,
  },
  redirectInner: {
    padding: '40px 48px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  redirectSpinWrap: {
    position: 'relative',
    width: 72,
    height: 72,
    flexShrink: 0,
  },
  redirectRing: {
    position: 'absolute',
    inset: 0,
    border: '2.5px solid rgba(0,180,216,0.18)',
    borderTopColor: '#00B4D8',
    borderRightColor: 'rgba(6,214,160,0.55)',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
  },
  redirectRingInner: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  redirectTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--ink)',
    letterSpacing: '-0.01em',
    textAlign: 'center',
  },
  redirectSub: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    textAlign: 'center',
    lineHeight: 1.55,
    letterSpacing: '0.01em',
  },
};
