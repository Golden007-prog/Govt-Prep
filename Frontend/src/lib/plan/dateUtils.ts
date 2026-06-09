// Date helpers that work on calendar dates (YYYY-MM-DD) in UTC to avoid timezone drift.

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Inclusive day count from start to end (start==end → 1). Negative spans clamp to 1. */
export function daysInclusive(startISO: string, endISO: string): number {
  const start = parseISODate(startISO).getTime();
  const end = parseISODate(endISO).getTime();
  const diff = Math.round((end - start) / 86_400_000);
  return Math.max(1, diff + 1);
}

/** Days from start until end, NOT counting today (countdown style). */
export function daysUntil(endISO: string, fromISO: string): number {
  const from = parseISODate(fromISO).getTime();
  const end = parseISODate(endISO).getTime();
  return Math.round((end - from) / 86_400_000);
}

export function todayISO(): string {
  return toISODate(new Date());
}
