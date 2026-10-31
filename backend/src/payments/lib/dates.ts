// DATE values travel as 'YYYY-MM-DD' strings end to end, so they never shift
// across time zones. String comparison of that format is chronological.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}
