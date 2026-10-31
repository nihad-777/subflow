// The billing run: turns due subscriptions into draft invoices.
//
// Nothing is billed twice: invoices has a unique key on (subscription, period), and the
// insert skips on conflict, so re-running a date creates nothing.
// Nothing is skipped: each subscription loops until its next billing date is past the run date.
import { query, queryOne, withTransaction, type Tx } from '../payments/lib/db.js';
import { addDays } from '../payments/lib/dates.js';
import { centsToSql, toCents } from '../payments/lib/money.js';
import { applyDiscounts, DiscountLimitReachedError, recordDiscountUsage } from '../payments/modules/discounts/discount.service.js';
import { logEvent, nextNumber, nextPeriodStart, type Frequency } from './shared.js';

export interface RunSummary {
  runDate: string;
  subscriptions: number;
  invoicesCreated: number;
  duplicatesSkipped: number;
  closed: number;
  failed: number;
}

/** Rounded per line, so line taxes always add up to the invoice's tax. */
export const lineTaxCents = (netCents: number, ratePercent: number) => Math.round((netCents * ratePercent) / 100);

async function billOnePeriod(tx: Tx, sub: any, periodStart: string, periodEnd: string) {
  const items = await query(
    `SELECT i.id, i.product_id, i.description, i.quantity, i.unit_price, COALESCE(t.tax_rate, 0)::float AS tax_rate
       FROM subscription_items i LEFT JOIN tax_rules t ON t.id = i.tax_rule_id AND t.is_active
      WHERE i.subscription_id = $1 ORDER BY i.created_at`,
    [sub.id], tx);
  const priced = await applyDiscounts({
    subscriptionId: sub.id,
    invoiceDate: periodStart,
    lines: items.map((i) => ({ lineId: i.id, productId: i.product_id, quantity: Number(i.quantity), unitPrice: i.unit_price })),
  }, tx);

  const lines = items.map((item, idx) => {
    const netCents = toCents(priced.lines[idx].netAmount);
    return { item, netCents, taxCents: lineTaxCents(netCents, item.tax_rate) };
  });
  const subtotal = toCents(priced.subtotal);
  const discount = toCents(priced.discountTotal);
  const tax = lines.reduce((a, l) => a + l.taxCents, 0);
  const number = await nextNumber(tx, 'INV', periodStart);

  const invoice = await queryOne<{ id: string }>(
    `INSERT INTO invoices (invoice_number, subscription_id, customer_id, invoice_date, due_date, billing_period_start, billing_period_end,
                           subtotal, tax_amount, discount_amount, total_amount, status)
     VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,'draft')
     ON CONFLICT ON CONSTRAINT unique_subscription_billing_period DO NOTHING RETURNING id`,
    [number, sub.id, sub.customer_id, periodStart, addDays(periodStart, sub.payment_terms_days), periodEnd,
     centsToSql(subtotal), centsToSql(tax), centsToSql(discount), centsToSql(subtotal - discount + tax)],
    tx);
  if (!invoice) return false;

  for (const { item, netCents, taxCents } of lines) {
    await tx.query(
      `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [invoice.id, item.product_id, item.description ?? 'Subscription', item.quantity, item.unit_price, item.tax_rate, centsToSql(taxCents), centsToSql(netCents + taxCents)]);
  }
  await recordDiscountUsage(tx, invoice.id, priced.discountsUsed);
  return true;
}

/** Bills every due period of one subscription. Each period commits on its own. */
async function billSubscription(id: string, runDate: string, summary: RunSummary) {
  for (;;) {
    const outcome = await withTransaction(async (tx) => {
      const sub = await queryOne(
        `SELECT s.*, pl.auto_close FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
          WHERE s.id = $1 AND s.status = 'active' FOR UPDATE OF s`,
        [id], tx);
      if (!sub || !sub.next_billing_date || sub.next_billing_date > runDate) return 'done';

      const periodStart: string = sub.next_billing_date;
      if (sub.end_date && periodStart > sub.end_date) {
        if (!sub.auto_close) return 'done';
        await tx.query(`UPDATE subscriptions SET status = 'closed', next_billing_date = NULL, updated_at = now() WHERE id = $1`, [id]);
        await logEvent(tx, id, 'active', 'closed', null, 'Closed automatically at the end of its term');
        summary.closed++;
        return 'done';
      }
      const next = nextPeriodStart(sub.start_date, sub.billing_frequency as Frequency, periodStart);
      const created = await billOnePeriod(tx, sub, periodStart, addDays(next, -1));
      await tx.query('UPDATE subscriptions SET next_billing_date = $2, updated_at = now() WHERE id = $1', [id, next]);
      return created ? 'created' : 'duplicate';
    });
    if (outcome === 'done') return;
    if (outcome === 'created') summary.invoicesCreated++;
    else summary.duplicatesSkipped++;
  }
}

export async function runBilling(runDate: string): Promise<RunSummary> {
  const due = await query<{ id: string }>(
    `SELECT id FROM subscriptions WHERE status = 'active' AND next_billing_date <= $1 ORDER BY next_billing_date`,
    [runDate]);
  const summary: RunSummary = { runDate, subscriptions: due.length, invoicesCreated: 0, duplicatesSkipped: 0, closed: 0, failed: 0 };
  for (const { id } of due) {
    try {
      await billSubscription(id, runDate, summary);
    } catch (err) {
      // Another run took a discount's last slot. The rollback left the period unbilled, so rebuild it once.
      if (err instanceof DiscountLimitReachedError) {
        try {
          await billSubscription(id, runDate, summary);
          continue;
        } catch { /* counted as failed below */ }
      }
      console.error(`Billing failed for subscription ${id}`, err);
      summary.failed++;
    }
  }
  return summary;
}
