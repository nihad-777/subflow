// Helpers shared by the billing module (subscriptions, invoices, catalog).
import type { Db, Tx } from '../payments/lib/db.js';
import { queryOne } from '../payments/lib/db.js';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Atomic per-year counter: SUB/2026/0001. The row lock keeps numbers unique under concurrency. */
export async function nextNumber(tx: Tx, series: 'SUB' | 'INV', onDate: string) {
  const year = Number(onDate.slice(0, 4));
  const row = await queryOne<{ last_value: number }>(
    `INSERT INTO number_series (series, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (series, year) DO UPDATE SET last_value = number_series.last_value + 1
     RETURNING last_value`,
    [series, year],
    tx,
  );
  return `${series}/${year}/${String(row!.last_value).padStart(4, '0')}`;
}

function shift(anchor: string, frequency: Frequency, n: number) {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + n);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
  else {
    // Clamp to the month's last day, always from the anchor, so 31 Jan -> 28 Feb -> 31 Mar.
    const months = frequency === 'monthly' ? n : 12 * n;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

/** First period boundary after `current`, counted from the subscription's start date. */
export function nextPeriodStart(anchor: string, frequency: Frequency, current: string) {
  let n = 1;
  while (shift(anchor, frequency, n) <= current) n++;
  return shift(anchor, frequency, n);
}

export async function logEvent(db: Db, subscriptionId: string, from: string | null, to: string, actorId: string | null, note?: string) {
  await db.query(
    'INSERT INTO subscription_events (subscription_id, from_status, to_status, note, actor_id) VALUES ($1,$2,$3,$4,$5)',
    [subscriptionId, from, to, note ?? null, actorId],
  );
}
