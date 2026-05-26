import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface BatchSettings {
  enabled: boolean;
  time: string;          // "09:00"
  days: string[];        // ["mon","tue","wed","thu","fri"]
}

const DEFAULT_BATCH: BatchSettings = {
  enabled: true,
  time: '09:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
};

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

/** Load the configured batch-send time/days from system_settings. */
export function useBatchSettings() {
  return useQuery({
    queryKey: ['system_settings', 'batch'],
    queryFn: async (): Promise<BatchSettings> => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('key, value')
        .in('key', ['batch_send_enabled', 'batch_send_time', 'batch_send_days']);
      if (error || !data) return DEFAULT_BATCH;
      const map = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]));
      return {
        enabled: (map.batch_send_enabled ?? 'true') !== 'false',
        time: map.batch_send_time ?? DEFAULT_BATCH.time,
        days: (map.batch_send_days ?? DEFAULT_BATCH.days.join(','))
          .split(',')
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean),
      };
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Given batch settings, return the next slot as a Date (local time) and a
 * human-readable label like "Mon 26 May, 09:00".
 */
export function nextBatchSlot(s: BatchSettings, from: Date = new Date()): {
  date: Date;
  label: string;
} | null {
  if (!s.enabled || s.days.length === 0) return null;

  const [hh, mm] = s.time.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  // Try today + next 7 days, return the first matching weekday whose time
  // is still in the future.
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hh, mm, 0, 0);
    const dow = DAY_NAMES[candidate.getDay()];
    if (!s.days.includes(dow)) continue;
    if (candidate.getTime() <= from.getTime()) continue;
    return {
      date: candidate,
      label: formatSlot(candidate),
    };
  }
  return null;
}

function formatSlot(d: Date): string {
  const dow = DAY_LABELS[DAY_NAMES[d.getDay()]].slice(0, 3);
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dow} ${day} ${month}, ${hh}:${mm}`;
}

/** Format an arbitrary ISO timestamp the same way as the batch label. */
export function formatScheduledAt(iso: string): string {
  return formatSlot(new Date(iso));
}
