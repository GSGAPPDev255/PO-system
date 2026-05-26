/**
 * SendApprovalControls — split button + custom date/time popover used to
 * mark a PO ready for approval, either immediately, at the next batch slot,
 * or at a custom scheduled time.
 *
 * Used in InvoiceReview when the PO is in pending_finance_review status.
 */

import { useRef, useState, useEffect } from 'react';
import { useBatchSettings, nextBatchSlot } from '../../hooks/useBatchSchedule';

type Mode = 'now' | 'batch' | 'custom';

interface Props {
  disabled: boolean;
  hint?: string;
  busy: boolean;
  onSend: (scheduledAt: string | null) => void;
}

export default function SendApprovalControls({ disabled, hint, busy, onSend }: Props) {
  const { data: settings } = useBatchSettings();
  const [menuOpen, setMenuOpen]   = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAt, setCustomAt]   = useState(defaultCustomDateTime());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close menus on outside-click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCustomOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const slot = settings ? nextBatchSlot(settings) : null;

  function fire(mode: Mode) {
    setMenuOpen(false);
    if (mode === 'now') {
      onSend(null);
    } else if (mode === 'batch' && slot) {
      onSend(slot.date.toISOString());
    } else if (mode === 'custom') {
      setCustomOpen(true);
    }
  }

  function confirmCustom() {
    if (!customAt) return;
    // Treat the input as local time and convert to ISO.
    const d = new Date(customAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return;
    setCustomOpen(false);
    onSend(d.toISOString());
  }

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <div style={styles.btnRow}>
        <button
          className="btn"
          style={{ ...styles.primary, ...(disabled || busy ? styles.disabled : {}) }}
          onClick={() => fire('now')}
          disabled={disabled || busy}
          title={disabled ? hint : 'Send approval email now'}
        >
          {busy ? 'Sending…' : 'Send for Approval'}
          <span style={styles.arrow}>→</span>
        </button>
        <button
          className="btn"
          style={{ ...styles.split, ...(disabled || busy ? styles.disabled : {}) }}
          onClick={() => !disabled && !busy && setMenuOpen((v) => !v)}
          disabled={disabled || busy}
          aria-label="More send options"
          title="Schedule send"
        >
          ▾
        </button>
      </div>

      {menuOpen && !disabled && (
        <div style={styles.menu}>
          <button style={styles.menuItem} onClick={() => fire('now')}>
            <div style={styles.menuItemTitle}>Send now</div>
            <div style={styles.menuItemSub}>Email goes out immediately</div>
          </button>
          {slot ? (
            <button style={styles.menuItem} onClick={() => fire('batch')}>
              <div style={styles.menuItemTitle}>Send at next batch</div>
              <div style={styles.menuItemSub}>{slot.label}</div>
            </button>
          ) : (
            <div style={{ ...styles.menuItem, opacity: 0.5, cursor: 'default' }}>
              <div style={styles.menuItemTitle}>Send at next batch</div>
              <div style={styles.menuItemSub}>Batch slot disabled in settings</div>
            </div>
          )}
          <button style={styles.menuItem} onClick={() => fire('custom')}>
            <div style={styles.menuItemTitle}>Schedule custom…</div>
            <div style={styles.menuItemSub}>Pick a date and time</div>
          </button>
        </div>
      )}

      {customOpen && (
        <div style={styles.customWrap}>
          <div style={styles.customKicker}>§ Schedule custom send</div>
          <label style={styles.customLabel}>Send approval email at</label>
          <input
            type="datetime-local"
            style={styles.customInput}
            value={customAt}
            min={minDateTimeAttr()}
            onChange={(e) => setCustomAt(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={styles.customBtn} onClick={confirmCustom}>
              Schedule →
            </button>
            <button style={styles.customCancel} onClick={() => setCustomOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {disabled && hint && <div style={styles.hint}>{hint}</div>}
    </div>
  );
}

function defaultCustomDateTime(): string {
  // Default to "tomorrow at 09:00 local"
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toDateTimeLocal(d);
}

function minDateTimeAttr(): string {
  // Now + 5 minutes (so the user can't schedule the past).
  const d = new Date(Date.now() + 5 * 60 * 1000);
  return toDateTimeLocal(d);
}

function toDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-block' },
  btnRow: { display: 'inline-flex', alignItems: 'stretch' },
  primary: {
    background: 'linear-gradient(135deg, #00b4d8 0%, #06d6a0 100%)',
    color: '#fff',
    border: '1px solid rgba(0,180,216,0.6)',
    borderRight: 'none',
    borderRadius: '8px 0 0 8px',
    padding: '12px 22px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 4px 16px rgba(0,180,216,0.25)',
  },
  split: {
    background: 'linear-gradient(135deg, #00b4d8 0%, #06d6a0 100%)',
    color: '#fff',
    border: '1px solid rgba(0,180,216,0.6)',
    borderRadius: '0 8px 8px 0',
    padding: '12px 14px',
    fontSize: 12,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,180,216,0.25)',
    borderLeft: '1px solid rgba(255,255,255,0.25)',
  },
  arrow: { fontFamily: 'var(--font-mono)', fontSize: 14 },
  disabled: { opacity: 0.5, cursor: 'not-allowed', boxShadow: 'none' },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: 270,
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.15)',
    zIndex: 60,
    padding: 6,
  },
  menuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    background: 'transparent',
    border: 'none',
    padding: '10px 14px',
    cursor: 'pointer',
    borderRadius: 6,
    color: 'var(--ink)',
  },
  menuItemTitle: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' },
  menuItemSub: { fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 },
  customWrap: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: 280,
    background: 'var(--paper-bright)',
    border: '1px solid var(--accent)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
    zIndex: 60,
    padding: 16,
  },
  customKicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.15em',
    marginBottom: 10,
  },
  customLabel: {
    display: 'block',
    fontSize: 11,
    color: 'var(--ink-muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.15em',
    marginBottom: 6,
  },
  customInput: {
    width: '100%',
    padding: '9px 10px',
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    color: 'var(--ink)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  customBtn: {
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  customCancel: {
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--ink-muted)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  hint: {
    fontSize: 11,
    color: 'var(--ink-muted)',
    marginTop: 8,
    fontStyle: 'italic',
  },
};
