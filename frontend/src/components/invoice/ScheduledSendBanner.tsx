/**
 * ScheduledSendBanner — shown on InvoiceReview when a PO is in
 * pending_approval but has scheduled_send_at in the future (i.e. the
 * approval email has been queued but not yet sent).
 *
 * Lets finance send-now-anyway or cancel the schedule and reopen the PO.
 */

import { formatScheduledAt } from '../../hooks/useBatchSchedule';
import { useCancelScheduledSend, useSendScheduledNow } from '../../hooks/useApprovals';

interface Props {
  poId: string;
  scheduledAt: string;
}

export default function ScheduledSendBanner({ poId, scheduledAt }: Props) {
  const sendNow = useSendScheduledNow();
  const cancel  = useCancelScheduledSend();

  const isPast = new Date(scheduledAt).getTime() <= Date.now();

  return (
    <div style={styles.wrap}>
      <div style={styles.left}>
        <div style={styles.icon}>⏰</div>
        <div>
          <div style={styles.kicker}>
            {isPast ? 'Awaiting dispatcher' : 'Approval send scheduled'}
          </div>
          <div style={styles.title}>
            {isPast
              ? 'The send time has passed — the next cron run will dispatch this approval email.'
              : `Approval email will go out on ${formatScheduledAt(scheduledAt)}.`}
          </div>
          <div style={styles.sub}>
            Finance can override below to send it now, or cancel and re-open the invoice.
          </div>
        </div>
      </div>
      <div style={styles.actions}>
        <button
          style={styles.sendBtn}
          disabled={sendNow.isPending || cancel.isPending}
          onClick={() => sendNow.mutate(poId)}
        >
          {sendNow.isPending ? 'Sending…' : 'Send now anyway →'}
        </button>
        <button
          style={styles.cancelBtn}
          disabled={sendNow.isPending || cancel.isPending}
          onClick={() => {
            if (confirm('Cancel scheduled send and re-open this invoice for finance review?')) {
              cancel.mutate(poId);
            }
          }}
        >
          Cancel schedule
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    background: 'linear-gradient(135deg, rgba(123,97,255,0.08) 0%, rgba(0,180,216,0.06) 100%)',
    border: '1px solid rgba(123,97,255,0.25)',
    borderRadius: 12,
    margin: '0 0 18px',
    flexWrap: 'wrap',
  },
  left: { display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 280 },
  icon: { fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 2 },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 700,
    color: '#7B61FF',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.18em',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--ink)',
    lineHeight: 1.4,
  },
  sub: {
    fontSize: 12,
    color: 'var(--ink-muted)',
    marginTop: 4,
    lineHeight: 1.5,
  },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  sendBtn: {
    padding: '9px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    background: 'linear-gradient(135deg, #00b4d8 0%, #06d6a0 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    boxShadow: '0 3px 12px rgba(0,180,216,0.2)',
  },
  cancelBtn: {
    padding: '9px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--ink-muted)',
    border: '1px solid var(--line)',
    borderRadius: 7,
    cursor: 'pointer',
  },
};
