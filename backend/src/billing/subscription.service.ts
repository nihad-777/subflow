// Subscriptions: creation from a quote or by hand, the status lifecycle, and renewals.
import { z } from 'zod';
import { pool, query, queryOne, withTransaction, type Db, type Tx } from '../payments/lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../payments/lib/errors.js';
import { addDays, todayStr } from '../payments/lib/dates.js';
import { parse } from '../payments/lib/http.js';
import type { AuthUser } from '../payments/middleware/auth.js';
import { logEvent, nextNumber, nextPeriodStart, type Frequency } from './shared.js';

export const STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/** Every legal step. Anything else is refused, so a Draft can never jump to Active. */
export const TRANSITIONS: Record<Status, Status[]> = {
  draft: ['quotation', 'closed'],
  quotation: ['draft', 'confirmed', 'closed'],
  confirmed: ['active', 'closed'],
  active: ['paused', 'closed'],
  paused: ['active', 'closed'],
  closed: [],
};

const optionalId = z.string().uuid().nullable().optional().or(z.literal('').transform(() => null));
const lineSchema = z.object({
  productId: z.string().uuid(),
  variantId: optionalId,
  description: z.string().max(300).optional(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().min(0).nullable().optional(),
  taxRuleId: optionalId,
});
const createSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  templateId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null)),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(15),
  lines: z.array(lineSchema).default([]),
});

const SUB_SELECT = `
  SELECT s.id, s.subscription_number AS number, s.status, s.customer_id AS "customerId", c.full_name AS "customerName", c.email AS "customerEmail",
         s.plan_id AS "planId", pl.name AS "planName", s.billing_frequency AS frequency, s.start_date AS "startDate", s.end_date AS "endDate",
         s.next_billing_date AS "nextBillingDate", s.payment_terms_days AS "paymentTermsDays", s.quote_expires_on AS "quoteExpiresOn",
         pl.allow_pause AS "allowPause", pl.allow_early_close AS "allowEarlyClose", pl.allow_renew AS "allowRenew"
    FROM subscriptions s JOIN profiles c ON c.id = s.customer_id JOIN plans pl ON pl.id = s.plan_id`;

async function insertLine(tx: Tx, subscriptionId: string, l: z.infer<typeof lineSchema>) {
  const product = await queryOne('SELECT name, price FROM products WHERE id = $1', [l.productId], tx);
  if (!product) throw notFound('Product');
  const variant = l.variantId
    ? await queryOne('SELECT name, price_adjustment FROM product_variants WHERE id = $1 AND product_id = $2', [l.variantId, l.productId], tx)
    : null;
  if (l.variantId && !variant) throw notFound('Variant');
  // Price snapshot: later catalog changes never rewrite an agreed subscription.
  const unitPrice = l.unitPrice ?? Number(product.price) + Number(variant?.price_adjustment ?? 0);
  await tx.query(
    `INSERT INTO subscription_items (subscription_id, product_id, product_variant_id, description, quantity, unit_price, tax_rule_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [subscriptionId, l.productId, l.variantId ?? null, l.description || (variant ? `${product.name} (${variant.name})` : product.name), l.quantity, unitPrice, l.taxRuleId ?? null],
  );
}

export async function createSubscription(body: unknown, actor: AuthUser) {
  const b = parse(createSchema, body);
  if (b.endDate && b.endDate < b.startDate) throw badRequest('INVALID_DATES', 'The expiry date cannot be before the start date');
  return withTransaction(async (tx) => {
    const template = b.templateId
      ? await queryOne('SELECT plan_id, validity_days, line_items FROM quotation_templates WHERE id = $1', [b.templateId], tx)
      : null;
    if (b.templateId && !template) throw notFound('Quotation template');
    const planId = b.planId ?? template?.plan_id;
    if (!planId) throw badRequest('PLAN_REQUIRED', 'Choose a recurring plan');
    const plan = await queryOne('SELECT frequency, min_quantity FROM plans WHERE id = $1', [planId], tx);
    if (!plan) throw notFound('Plan');
    const customer = await queryOne(`SELECT id FROM profiles WHERE id = $1 AND role = 'customer'`, [b.customerId], tx);
    if (!customer) throw notFound('Customer');

    const lines = b.lines.length ? b.lines : parse(z.array(lineSchema), template?.line_items ?? []);
    if (!lines.length) throw badRequest('LINES_REQUIRED', 'Add at least one product line');
    const quantity = lines.reduce((a, l) => a + l.quantity, 0);
    if (quantity < plan.min_quantity) throw badRequest('BELOW_MIN_QUANTITY', `This plan needs at least ${plan.min_quantity} units`);

    const status: Status = template ? 'quotation' : 'draft';
    const number = await nextNumber(tx, 'SUB', b.startDate);
    const sub = await queryOne<{ id: string }>(
      `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, billing_frequency, start_date, end_date, status, payment_terms_days, quote_expires_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [number, b.customerId, planId, plan.frequency, b.startDate, b.endDate ?? null, status, b.paymentTermsDays, template ? addDays(todayStr(), template.validity_days) : null],
      tx,
    );
    for (const l of lines) await insertLine(tx, sub!.id, l);
    await logEvent(tx, sub!.id, null, status, actor.id, template ? 'Created from a quotation template' : 'Created');
    return getSubscription(sub!.id, actor, tx);
  });
}

export async function listSubscriptions(f: { status?: string; q?: string; customerId?: string; hideDrafts?: boolean; offset: number; limit: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.status) add('s.status = ?', f.status);
  if (f.customerId) add('s.customer_id = ?', f.customerId);
  if (f.hideDrafts) where.push(`s.status <> 'draft'`);
  if (f.q) add(`(s.subscription_number || ' ' || c.full_name) ILIKE ?`, `%${f.q}%`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [items, count] = await Promise.all([
    query(`${SUB_SELECT} ${clause} ORDER BY s.created_at DESC, s.id LIMIT ${f.limit} OFFSET ${f.offset}`, params),
    queryOne(`SELECT count(*)::int AS n FROM subscriptions s JOIN profiles c ON c.id = s.customer_id ${clause}`, params),
  ]);
  return { items, total: count!.n };
}

export async function getSubscription(id: string, actor: AuthUser, db: Db = pool) {
  const sub = await queryOne(`${SUB_SELECT} WHERE s.id = $1`, [id], db);
  // Same answer as a missing row, so ids cannot be probed.
  if (!sub || (actor.role === 'CUSTOMER' && (sub.customerId !== actor.id || sub.status === 'draft'))) throw notFound('Subscription');
  const lines = await query(
    `SELECT i.id, i.product_id AS "productId", i.description, i.quantity::float AS quantity, i.unit_price::float AS "unitPrice",
            t.name AS "taxName", COALESCE(t.tax_rate, 0)::float AS "taxRate"
       FROM subscription_items i LEFT JOIN tax_rules t ON t.id = i.tax_rule_id WHERE i.subscription_id = $1 ORDER BY i.created_at`,
    [id], db);
  const events = await query(
    `SELECT e.from_status AS "from", e.to_status AS "to", e.note, e.created_at AS at, p.full_name AS actor
       FROM subscription_events e LEFT JOIN profiles p ON p.id = e.actor_id WHERE e.subscription_id = $1 ORDER BY e.id`,
    [id], db);
  return { ...sub, lines, events, nextStatuses: TRANSITIONS[sub.status as Status] };
}

/** The one place a status changes. Locks the row so two people cannot race. */
export async function changeStatus(id: string, to: Status, actor: AuthUser, note?: string) {
  return withTransaction(async (tx) => {
    const sub = await queryOne(
      `SELECT s.status, s.customer_id, s.start_date, s.next_billing_date, s.quote_expires_on, s.billing_frequency,
              pl.allow_pause, pl.allow_early_close
         FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1 FOR UPDATE OF s`,
      [id], tx);
    if (!sub || (actor.role === 'CUSTOMER' && sub.customer_id !== actor.id)) throw notFound('Subscription');
    const from = sub.status as Status;
    if (!TRANSITIONS[from].includes(to)) throw conflict('ILLEGAL_TRANSITION', `A ${from} subscription cannot become ${to}`);
    if (actor.role === 'CUSTOMER') {
      const allowed = (from === 'quotation' && to === 'confirmed')
        || (from === 'active' && to === 'paused' && sub.allow_pause)
        || (from === 'paused' && to === 'active' && sub.allow_pause)
        || (to === 'closed' && sub.allow_early_close && (from === 'active' || from === 'paused'));
      if (!allowed) throw forbidden('Your plan does not allow this change');
    }
    if (from === 'quotation' && to === 'confirmed' && sub.quote_expires_on && sub.quote_expires_on < todayStr()) {
      throw conflict('QUOTE_EXPIRED', 'This quotation has expired');
    }
    // First activation bills from the start date. Resuming skips the periods spent paused.
    let next: string | null = sub.next_billing_date;
    if (to === 'active' && !next) next = sub.start_date;
    if (to === 'active' && from === 'paused' && next! < todayStr()) {
      next = nextPeriodStart(sub.start_date, sub.billing_frequency as Frequency, addDays(todayStr(), -1));
    }
    await tx.query(
      'UPDATE subscriptions SET status = $2, next_billing_date = $3, updated_at = now() WHERE id = $1',
      [id, to, to === 'closed' ? null : next],
    );
    await logEvent(tx, id, from, to, actor.id, note);
    return getSubscription(id, actor, tx);
  });
}

/** Active: extends the expiry by one period. Closed: starts a fresh subscription with the same lines. */
export async function renewSubscription(id: string, actor: AuthUser) {
  return withTransaction(async (tx) => {
    const sub = await queryOne(
      'SELECT s.*, pl.allow_renew FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id WHERE s.id = $1 FOR UPDATE OF s',
      [id], tx);
    if (!sub || (actor.role === 'CUSTOMER' && sub.customer_id !== actor.id)) throw notFound('Subscription');
    if (!sub.allow_renew) throw conflict('RENEW_NOT_ALLOWED', 'This plan cannot be renewed');
    const frequency = sub.billing_frequency as Frequency;
    if (sub.status === 'active' || sub.status === 'paused') {
      if (!sub.end_date) throw conflict('NOTHING_TO_RENEW', 'This subscription has no expiry date');
      const endDate = nextPeriodStart(sub.start_date, frequency, sub.end_date);
      await tx.query('UPDATE subscriptions SET end_date = $2, updated_at = now() WHERE id = $1', [id, endDate]);
      await logEvent(tx, id, sub.status, sub.status, actor.id, `Renewed until ${endDate}`);
      return getSubscription(id, actor, tx);
    }
    if (sub.status !== 'closed') throw conflict('ILLEGAL_TRANSITION', 'Only active or closed subscriptions can be renewed');
    const start = todayStr();
    const number = await nextNumber(tx, 'SUB', start);
    const fresh = await queryOne<{ id: string }>(
      `INSERT INTO subscriptions (subscription_number, customer_id, plan_id, billing_frequency, start_date, next_billing_date, status, payment_terms_days, renewed_from)
       VALUES ($1,$2,$3,$4,$5,$5,'active',$6,$7) RETURNING id`,
      [number, sub.customer_id, sub.plan_id, frequency, start, sub.payment_terms_days, id], tx);
    await tx.query(
      `INSERT INTO subscription_items (subscription_id, product_id, product_variant_id, description, quantity, unit_price, tax_rule_id)
       SELECT $1, product_id, product_variant_id, description, quantity, unit_price, tax_rule_id FROM subscription_items WHERE subscription_id = $2`,
      [fresh!.id, id]);
    await logEvent(tx, fresh!.id, null, 'active', actor.id, `Renewed from ${sub.subscription_number}`);
    return getSubscription(fresh!.id, actor, tx);
  });
}
