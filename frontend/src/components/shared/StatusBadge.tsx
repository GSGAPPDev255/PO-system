import type { InvoiceStatus } from '../../lib/supabase';

const STATUS_CONFIG: Record<
  InvoiceStatus,
  { label: string; dot: string; text: string; bg: string; border: string }
> = {
  pending_finance_review: {
    label: 'Pending Review',
    dot:   'var(--warning)',
    text:  'var(--warning)',
    bg:    'var(--warning-soft)',
    border: 'rgba(245, 158, 11, 0.25)',
  },
  pending_approval: {
    label: 'Pending Approval',
    dot:   'var(--accent)',
    text:  'var(--accent-text)',
    bg:    'var(--accent-soft)',
    border: 'rgba(0, 198, 224, 0.25)',
  },
  approved: {
    label: 'Approved',
    dot:   'var(--success)',
    text:  'var(--success)',
    bg:    'var(--success-soft)',
    border: 'rgba(16, 185, 129, 0.25)',
  },
  rejected: {
    label: 'Rejected',
    dot:   'var(--danger)',
    text:  'var(--danger)',
    bg:    'var(--danger-soft)',
    border: 'rgba(244, 63, 94, 0.25)',
  },
  approved_ready_export: {
    label: 'Ready to Export',
    dot:   '#7B61FF',
    text:  '#A89DFF',
    bg:    'rgba(123, 97, 255, 0.14)',
    border: 'rgba(123, 97, 255, 0.25)',
  },
  exported: {
    label: 'Exported',
    dot:   'var(--ink-faint)',
    text:  'var(--ink-muted)',
    bg:    'rgba(255,255,255,0.04)',
    border: 'var(--line)',
  },
  dismissed: {
    label: 'Dismissed',
    dot:   'var(--ink-faint)',
    text:  'var(--ink-faint)',
    bg:    'transparent',
    border: 'var(--line)',
  },
};

export default function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status, dot: 'var(--ink-faint)', text: 'var(--ink-muted)',
    bg: 'transparent', border: 'var(--line-strong)',
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '3px 10px 3px 9px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: cfg.text,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: cfg.dot,
          boxShadow: `0 0 0 2px ${cfg.bg === 'transparent' ? 'var(--paper)' : cfg.bg}`,
        }}
      />
      {cfg.label}
    </span>
  );
}
