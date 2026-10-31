// Every number here is a single SQL aggregate. Nothing loads rows into Node.
import { query, queryOne } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';
import { addDays, isValidDate, todayStr } from '../../lib/dates.js';
import { money } from '../../lib/money.js';

export interface ReportFilters {
  from: string;
  to: string;
  planId?: string;
  customerId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFilters(q: Record<string, unknown>): ReportFilters {
  const to = typeof q.to === 'string' && q.to ? q.to : todayStr();
  const from = typeof q.from === 'string' && q.from ? q.from : `${to.slice(0, 7)}-01`;
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('VALIDATION_ERROR', 'from/to must be YYYY-MM-DD');
  if (from > to) throw badRequest('VALIDATION_ERROR', 'from must be on or before to');
  const planId = typeof q.planId === 'string' && q.planId ? q.planId : undefined;
  if (planId && !UUID_RE.test(planId)) throw badRequest('VALIDATION_ERROR', 'Invalid planId');
  const customerId = typeof q.customerId === 'string' && q.customerId ? q.customerId : undefined;
  if (customerId && !UUID_RE.test(customerId)) throw badRequest('VALIDATION_ERROR', 'Invalid customerId');
  return { from, to, planId, customerId };
}

// Shared invoice-level filter. Plan comes from the invoice's subscription.
// With a range, $1/$2 are from/to and plan/customer follow; without, they start at $1.
function scope(f: Partial<ReportFilters>, withRange = true, alias = 'i') {
  const params: unknown[] = withRange ? [f.from, f.to] : [];
  const parts: string[] = [];
  if (f.customerId) {
    params.push(f.customerId);
    parts.push(`${alias}.customer_id = $${params.length}::uuid`);
  }
  if (f.planId) {
    params.push(f.planId);
    parts.push(`${alias}.subscription_id IN (SELECT id FROM subscriptions WHERE plan_id = $${params.length}::uuid)`);
  }
  return { params, and: parts.length ? ` AND ${parts.join(' AND ')}` : '' };
}

// Same filter, for queries rooted at subscriptions (alias s).
function subScope(f: Partial<ReportFilters>) {
  const params: unknown[] = [];
  const parts: string[] = [];
  if (f.customerId) {
    params.push(f.customerId);
    parts.push(`s.customer_id = $${params.length}::uuid`);
  }
  if (f.planId) {
    params.push(f.planId);
    parts.push(`s.plan_id = $${params.length}::uuid`);
  }
  return { params, and: parts.length ? ` AND ${parts.join(' AND ')}` : '' };
}

// Outstanding per CONFIRMED invoice, as of today. Reused by several reports.
const OPEN_INVOICES = `
  SELECT i.id, i.invoice_number, i.customer_id, i.subscription_id, i.invoice_date, i.due_date, i.total_amount,
         COALESCE(pp.paid, 0) AS paid,
         i.total_amount - COALESCE(pp.paid, 0) AS outstanding,
         CURRENT_DATE - i.due_date AS days_overdue
    FROM invoices i
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS paid FROM payments p WHERE p.invoice_id = i.id AND p.status = 'POSTED'
    ) pp ON true
   WHERE i.status = 'confirmed'`;

const BUCKET_SQL = `CASE
  WHEN days_overdue <= 0 THEN 'CURRENT'
  WHEN days_overdue <= 30 THEN '1-30'
  WHEN days_overdue <= 60 THEN '31-60'
  WHEN days_overdue <= 90 THEN '61-90'
  ELSE '90+' END`;

export const OVERDUE_BUCKETS = ['1-30', '31-60', '61-90', '90+'] as const;

// MRR: normalise each ACTIVE subscription's line total to one month.
const MONTH_FACTOR = `CASE upper(pl.frequency::text)
  WHEN 'DAILY' THEN 365.0/12 WHEN 'WEEKLY' THEN 52.0/12 WHEN 'YEARLY' THEN 1.0/12 ELSE 1 END`;

export async function summary(f: ReportFilters) {
  const inv = scope(f);
  const open = scope(f, false);
  const sub = subScope(f);
  const [subs, invoiced, collected, openRow] = await Promise.all([
    queryOne(
      `SELECT count(*)::int AS active,
              COALESCE(SUM(lt.line_total * ${MONTH_FACTOR}), 0)::numeric(14,2) AS mrr
         FROM subscriptions s
         JOIN plans pl ON pl.id = s.plan_id
         LEFT JOIN LATERAL (SELECT SUM(l.quantity * l.unit_price) AS line_total FROM subscription_items l WHERE l.subscription_id = s.id) lt ON true
        WHERE s.status = 'active' ${sub.and}`,
      sub.params,
    ),
    queryOne(
      `SELECT COALESCE(SUM(i.total_amount), 0) AS invoiced, COALESCE(SUM(i.discount_amount), 0) AS discounts, count(*)::int AS n
         FROM invoices i
        WHERE i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN $1 AND $2 ${inv.and}`,
      inv.params,
    ),
    queryOne(
      `SELECT COALESCE(SUM(p.amount), 0) AS collected, count(*)::int AS n
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.status = 'POSTED' AND p.payment_date BETWEEN $1 AND $2 ${inv.and}`,
      inv.params,
    ),
    queryOne(
      `WITH o AS (${OPEN_INVOICES} ${open.and})
       SELECT COALESCE(SUM(outstanding), 0) AS outstanding,
              count(*) FILTER (WHERE days_overdue > 0 AND outstanding > 0)::int AS overdue_count,
              COALESCE(SUM(outstanding) FILTER (WHERE days_overdue > 0 AND outstanding > 0), 0) AS overdue_amount
         FROM o`,
      open.params,
    ),
  ]);
  return {
    from: f.from,
    to: f.to,
    activeSubscriptions: subs!.active,
    mrr: money(subs!.mrr),
    invoicedAmount: money(invoiced!.invoiced),
    invoiceCount: invoiced!.n,
    collectedAmount: money(collected!.collected),
    paymentCount: collected!.n,
    outstandingAmount: money(openRow!.outstanding),
    overdueCount: openRow!.overdue_count,
    overdueAmount: money(openRow!.overdue_amount),
    discountsGiven: money(invoiced!.discounts),
  };
}

export async function revenueTrend(f: ReportFilters, granularity: string) {
  const g = ['day', 'week', 'month'].includes(granularity) ? granularity : 'month';
  const inv = scope(f);
  const rows = await query(
    `WITH buckets AS (
       SELECT generate_series(date_trunc('${g}', $1::date), date_trunc('${g}', $2::date), interval '1 ${g}')::date AS bucket
     ),
     invoiced AS (
       SELECT date_trunc('${g}', i.invoice_date)::date AS bucket, SUM(i.total_amount) AS amount
         FROM invoices i
        WHERE i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN $1 AND $2 ${inv.and}
        GROUP BY 1
     ),
     collected AS (
       SELECT date_trunc('${g}', p.payment_date)::date AS bucket, SUM(p.amount) AS amount
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.status = 'POSTED' AND p.payment_date BETWEEN $1 AND $2 ${inv.and}
        GROUP BY 1
     )
     SELECT b.bucket, COALESCE(iv.amount, 0) AS invoiced, COALESCE(c.amount, 0) AS collected
       FROM buckets b
       LEFT JOIN invoiced iv ON iv.bucket = b.bucket
       LEFT JOIN collected c ON c.bucket = b.bucket
      ORDER BY b.bucket`,
    inv.params,
  );
  return { granularity: g, points: rows.map((r) => ({ bucket: r.bucket, invoiced: money(r.invoiced), collected: money(r.collected) })) };
}

export async function revenueByPlan(f: ReportFilters) {
  const inv = scope(f);
  const rows = await query(
    `WITH invoiced AS (
       SELECT s.plan_id, SUM(i.total_amount) AS amount, count(*)::int AS n
         FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
        WHERE i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN $1 AND $2 ${inv.and}
        GROUP BY s.plan_id
     ),
     collected AS (
       SELECT s.plan_id, SUM(p.amount) AS amount
         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id
        WHERE p.status = 'POSTED' AND p.payment_date BETWEEN $1 AND $2 ${inv.and}
        GROUP BY s.plan_id
     )
     SELECT pl.id, pl.name, pl.frequency, COALESCE(iv.amount, 0) AS invoiced, COALESCE(iv.n, 0) AS invoice_count,
            COALESCE(c.amount, 0) AS collected
       FROM plans pl
       LEFT JOIN invoiced iv ON iv.plan_id = pl.id
       LEFT JOIN collected c ON c.plan_id = pl.id
      WHERE iv.amount IS NOT NULL OR c.amount IS NOT NULL
      ORDER BY invoiced DESC`,
    inv.params,
  );
  return rows.map((r) => ({
    planId: r.id,
    planName: r.name,
    billingPeriod: r.frequency,
    invoiced: money(r.invoiced),
    invoiceCount: r.invoice_count,
    collected: money(r.collected),
  }));
}

export async function paymentsByMethod(f: ReportFilters) {
  const inv = scope(f);
  const rows = await query(
    `SELECT p.method, SUM(p.amount) AS amount, count(*)::int AS n
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status = 'POSTED' AND p.payment_date BETWEEN $1 AND $2 ${inv.and}
      GROUP BY p.method ORDER BY amount DESC`,
    inv.params,
  );
  return rows.map((r) => ({ method: r.method, amount: money(r.amount), count: r.n }));
}

/** Outstanding by aging bucket, as of today (date range ignored). */
export async function aging(f: Omit<ReportFilters, 'from' | 'to'>) {
  const inv = scope(f, false);
  const rows = await query(
    `WITH o AS (${OPEN_INVOICES} ${inv.and})
     SELECT ${BUCKET_SQL} AS bucket, count(*)::int AS n, SUM(outstanding) AS amount
       FROM o WHERE outstanding > 0
      GROUP BY 1`,
    inv.params,
  );
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  return ['CURRENT', ...OVERDUE_BUCKETS].map((b) => ({
    bucket: b,
    count: byBucket.get(b)?.n ?? 0,
    amount: money(byBucket.get(b)?.amount ?? 0),
  }));
}

export async function topOutstanding(f: Omit<ReportFilters, 'from' | 'to'>, limit: number) {
  const inv = scope(f, false);
  const rows = await query(
    `WITH o AS (${OPEN_INVOICES} ${inv.and})
     SELECT c.id, c.full_name, c.email, count(*)::int AS invoices, SUM(o.outstanding) AS outstanding,
            COALESCE(SUM(o.outstanding) FILTER (WHERE o.days_overdue > 0), 0) AS overdue,
            MAX(o.days_overdue) AS max_days_overdue
       FROM o JOIN profiles c ON c.id = o.customer_id
      WHERE o.outstanding > 0
      GROUP BY c.id, c.full_name, c.email
      ORDER BY outstanding DESC
      LIMIT ${Math.min(50, Math.max(1, limit))}`,
    inv.params,
  );
  return rows.map((r) => ({
    customer: { id: r.id, name: r.full_name, email: r.email },
    invoiceCount: r.invoices,
    outstanding: money(r.outstanding),
    overdue: money(r.overdue),
    maxDaysOverdue: Math.max(0, r.max_days_overdue),
  }));
}

// ---------------------------------------------------------------------------
// Overdue invoices list (computed at query time: never stale, no cron)
// ---------------------------------------------------------------------------

export async function overdueInvoices(q: { bucket?: string; customerId?: string; minAmount?: number; offset: number; limit: number }) {
  if (q.bucket && !(OVERDUE_BUCKETS as readonly string[]).includes(q.bucket)) {
    throw badRequest('VALIDATION_ERROR', `bucket must be one of ${OVERDUE_BUCKETS.join(', ')}`);
  }
  if (q.customerId && !UUID_RE.test(q.customerId)) throw badRequest('VALIDATION_ERROR', 'Invalid customerId');
  const params: unknown[] = [];
  const conds = ['days_overdue > 0', 'outstanding > 0'];
  if (q.customerId) {
    params.push(q.customerId);
    conds.push(`customer_id = $${params.length}::uuid`);
  }
  if (q.minAmount && q.minAmount > 0) {
    params.push(q.minAmount);
    conds.push(`outstanding >= $${params.length}`);
  }
  const base = `WITH o AS (${OPEN_INVOICES}), od AS (SELECT o.*, ${BUCKET_SQL} AS bucket FROM o WHERE ${conds.join(' AND ')})`;

  const listParams = [...params];
  let bucketCond = '';
  if (q.bucket) {
    listParams.push(q.bucket);
    bucketCond = `WHERE od.bucket = $${listParams.length}`;
  }

  const [rows, buckets] = await Promise.all([
    query(
      `${base}
       SELECT od.*, c.full_name, c.email, count(*) OVER()::int AS total_rows
         FROM od JOIN profiles c ON c.id = od.customer_id
         ${bucketCond}
        ORDER BY od.days_overdue DESC, od.id
        LIMIT ${q.limit} OFFSET ${q.offset}`,
      listParams,
    ),
    query(`${base} SELECT bucket, count(*)::int AS n, SUM(outstanding) AS amount FROM od GROUP BY bucket`, params),
  ]);
  const bucketMap = new Map(buckets.map((b) => [b.bucket, b]));
  return {
    total: rows[0]?.total_rows ?? 0,
    buckets: OVERDUE_BUCKETS.map((b) => ({ bucket: b, count: bucketMap.get(b)?.n ?? 0, amount: money(bucketMap.get(b)?.amount ?? 0) })),
    items: rows.map((r) => ({
      invoiceId: r.id,
      number: r.invoice_number,
      customer: { id: r.customer_id, name: r.full_name, email: r.email },
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      daysOverdue: r.days_overdue,
      bucket: r.bucket,
      total: money(r.total_amount),
      amountPaid: money(r.paid),
      outstanding: money(r.outstanding),
    })),
  };
}

export const defaultRange = () => ({ from: addDays(todayStr(), -89), to: todayStr() });
