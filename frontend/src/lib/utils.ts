import { COLOR_ORDER, CLARITY_ORDER, SHAPES } from './theme';
import type { RequestStone } from './api';

export function timeAgo(ts: string): string {
  const then = new Date(ts).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function fmtCarat(c: number | string | null): string {
  if (c == null) return '—';
  const n = typeof c === 'string' ? Number(c) : c;
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

export function fmtMeasurements(length: number | string | null, width: number | string | null, height: number | string | null, ratio?: number | string | null): string {
  const numberOrNull = (value: number | string | null | undefined) => {
    const number = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(number) ? Number(number) : null;
  };
  const values = [numberOrNull(length), numberOrNull(width), numberOrNull(height)];
  if (values.some((value) => value === null)) return '-';
  const storedRatio = numberOrNull(ratio);
  const calculatedRatio = values[1] ? values[0]! / values[1]! : null;
  const shownRatio = storedRatio ?? calculatedRatio;
  return `${values.map((value) => value!.toFixed(2)).join(' x ')}${shownRatio ? ` | R ${shownRatio.toFixed(2)}` : ''}`;
}

// Color A-Z -> Clarity A-Z -> Shape A-Z -> Size, matching the request queue.
export function sortStonesClient<T extends Partial<RequestStone>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const c = String(a.color || '').localeCompare(String(b.color || ''));
    if (c !== 0) return c;
    const cl = String(a.clarity || '').localeCompare(String(b.clarity || ''));
    if (cl !== 0) return cl;
    const s = String(a.shape || '').localeCompare(String(b.shape || ''));
    if (s !== 0) return s;
    const ac = a.carat != null ? Number(a.carat) : 0;
    const bc = b.carat != null ? Number(b.carat) : 0;
    return ac - bc;
  });
}

export const STATUS_LABELS: Record<string, string> = {
  awaiting: 'Awaiting',
  half_fulfilled: 'Half fulfilled',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

export const TRACKING_LABELS: Record<string, string> = {
  requested: 'Requested',
  partially_given: 'Partially given',
  with_rep: 'With rep',
  returned: 'Returned',
};
