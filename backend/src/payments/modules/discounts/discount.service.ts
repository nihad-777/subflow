import { z } from 'zod';
import { pool, query, queryOne, withTransaction, isUniqueViolation, type Db, type Tx } from '../../lib/db.js';
import { badRequest, conflict, notFound, HttpError } from '../../lib/errors.js';
import { centsToSql, fromCents, hasAtMostTwoDecimals, money, toCents } from '../../lib/money.js';
import { isValidDate, todayStr } from '../../lib/dates.js';
import { parse } from '../../lib/http.js';
import { calculateDiscounts, type DiscountRule } from './discount.engine.js';

// ---------------------------------------------------------------------------
// Status (computed, never stored)
// ---------------------------------------------------------------------------

export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'INACTIVE';

interface DiscountRow {
  id: number;
  name: string;
  code: string | null;
  type: 'FIXED' | 'PERCENT';
  value: string;
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  min_purchase: string;
  min_quantity: number;
  start_date: string;
  end_date: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  created_at: Date;
  target_ids: string[];
}

export function discountStatus(
  d: Pick<DiscountRow, 'is_active' | 'start_date' | 'end_date' | 'usage_limit' | 'used_count'>,
  on = todayStr(),
): DiscountStatus {
  if (!d.is_active) return 'INACTIVE';
  if (d.usage_limit !== null && d.used_count >= d.usage_limit) return 'EXHAUSTED';
  if (d.end_date && d.end_date < on) return 'EXPIRED';
  if (d.start_date > on) return 'SCHEDULED';
  return 'ACTIVE';
}

// SQL twin of discountStatus(), used for filtering in the list endpoint.
const STATUS_SQL = `CASE
  WHEN NOT d.is_active THEN 'INACTIVE'
  WHEN d.usage_limit IS NOT NULL AND d.used_count >= d.usage_limit THEN 'EXHAUSTED'
  WHEN d.end_date IS NOT NULL AND d.end_date < CURRENT_DATE THEN 'EXPIRED'
  WHEN d.start_date > CURRENT_DATE THEN 'SCHEDULED'
  ELSE 'ACTIVE' END`;

const SELECT_DISCOUNT = `
  SELECT d.*, COALESCE(
    (SELECT array_agg(t.target_id ORDER BY t.target_id) FROM discount_targets t WHERE t.discount_id = d.id),
    '{}') AS target_ids
  FROM discounts d`;

export function serializeDiscount(d: DiscountRow) {
  return {
    id: d.id,
    name: d.name,
    code: d.code,
    type: d.type,
    value: money(d.value),
    scope: d.scope,
    minPurchase: money(d.min_purchase),
    minQuantity: d.min_quantity,
    startDate: d.start_date,
    endDate: d.end_date,
    usageLimit: d.usage_limit,
    usedCount: d.used_count,
    isActive: d.is_active,
    status: discountStatus(d),
    appliesToAll: d.target_ids.length === 0,
    targetIds: d.target_ids,
    createdAt: d.created_at,
  };
}

// ---------------------------------------------------------------------------
// Validation (mirrored on the frontend form)
// ---------------------------------------------------------------------------

const moneyInput = z
  .union([z.number(), z.string()])
  .refine((v) => hasAtMostTwoDecimals(v), 'Use at most 2 decimal places')
  .transform(Number);
const dateStr = z.string().refine(isValidDate, 'Use a valid YYYY-MM-DD date');

const discountBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: z.string().trim().max(40).nullish().transform((v) => (v ? v.toUpperCase() : null)),
  type: z.enum(['FIXED', 'PERCENT']),
  value: moneyInput,
  scope: z.enum(['PRODUCT', 'SUBSCRIPTION']),
  minPurchase: moneyInput.default(0),
  minQuantity: z.number().int().min(0).default(0),
  startDate: dateStr,
  endDate: dateStr.nullish(),
  usageLimit: z.number().int().min(1, 'Usage limit must be at least 1').nullish(),
  appliesToAll: z.boolean().default(false),
  targetIds: z.array(z.string().uuid()).default([]),
});

export const createDiscountSchema = discountBase;
export const updateDiscountSchema = discountBase.partial();
export type DiscountInput = z.infer<typeof discountBase>;

function checkRules(d: DiscountInput, usedCount = 0) {
  const issues: Record<string, string> = {};
  if (d.type === 'PERCENT' && (d.value <= 0 || d.value > 100)) issues.value = 'Percentage must be between 0 and 100';
  if (d.type === 'FIXED' && d.value <= 0) issues.value = 'Amount must be greater than 0';
  if (d.minPurchase < 0) issues.minPurchase = 'Cannot be negative';
  if (d.endDate && d.endDate < d.startDate) issues.endDate = 'End date must be on or after start date';
  if (d.usageLimit != null && d.usageLimit < usedCount) {
    issues.usageLimit = `Already used ${usedCount} times; limit cannot be lower`;
  }
  if (d.scope === 'PRODUCT' && !d.appliesToAll && d.targetIds.length === 0) {
    issues.targetIds = 'Pick at least one product, or choose "All products"';
  }
  if (Object.keys(issues).length) throw badRequest('VALIDATION_ERROR', 'Invalid discount', { fieldErrors: issues });
}

async function checkTargetsExist(scope: 'PRODUCT' | 'SUBSCRIPTION', ids: string[]) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const table = scope === 'PRODUCT' ? 'products' : 'subscriptions';
  const row = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`, [unique]);
  if (row!.n !== unique.length) {
    throw badRequest('VALIDATION_ERROR', 'Invalid discount', { fieldErrors: { targetIds: 'Some targets do not exist' } });
  }
}

async function writeTargets(tx: Tx, discountId: number, d: DiscountInput) {
  await tx.query('DELETE FROM discount_targets WHERE discount_id = $1', [discountId]);
  if (d.appliesToAll || !d.targetIds.length) return;
  await tx.query(
    `INSERT INTO discount_targets (discount_id, target_type, target_id)
     SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
    [discountId, d.scope, [...new Set(d.targetIds)]],
  );
}

const rethrowDuplicateCode = (err: unknown): never => {
  if (isUniqueViolation(err)) throw conflict('DUPLICATE_CODE', 'A discount with this code already exists');
  throw err;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listDiscounts(q: { status?: string; scope?: string; q?: string; offset: number; limit: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status) {
    params.push(q.status.toUpperCase());
    where.push(`(${STATUS_SQL}) = $${params.length}`);
  }
  if (q.scope) {
    params.push(q.scope.toUpperCase());
    where.push(`d.scope = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(d.name ILIKE $${params.length} OR d.code ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [count, rows] = await Promise.all([
    queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM discounts d ${whereSql}`, params),
    query<DiscountRow>(
      `${SELECT_DISCOUNT} ${whereSql} ORDER BY d.created_at DESC, d.id DESC LIMIT ${q.limit} OFFSET ${q.offset}`,
      params,
    ),
  ]);
  return { total: count!.n, items: rows.map(serializeDiscount) };
}

async function findDiscount(id: number, db: Db = pool) {
  return queryOne<DiscountRow>(`${SELECT_DISCOUNT} WHERE d.id = $1`, [id], db);
}

export async function getDiscount(id: number) {
  const d = await findDiscount(id);
  if (!d) throw notFound('Discount');
  const usages = await query(
    `SELECT u.invoice_id, u.amount, u.created_at, i.invoice_number, i.invoice_date, i.status, p.id AS customer_id, p.full_name
       FROM discount_usages u
       JOIN invoices i ON i.id = u.invoice_id
       JOIN profiles p ON p.id = i.customer_id
      WHERE u.discount_id = $1
      ORDER BY u.created_at DESC LIMIT 100`,
    [id],
  );
  return {
    ...serializeDiscount(d),
    usages: usages.map((u) => ({
      invoiceId: u.invoice_id,
      invoiceNumber: u.invoice_number,
      invoiceDate: u.invoice_date,
      invoiceStatus: u.status,
      customer: { id: u.customer_id, name: u.full_name },
      amount: money(u.amount),
      usedAt: u.created_at,
    })),
  };
}

export async function createDiscount(body: unknown, userId: string) {
  const d = parse(createDiscountSchema, body);
  checkRules(d);
  await checkTargetsExist(d.scope, d.appliesToAll ? [] : d.targetIds);
  const id = await withTransaction(async (tx) => {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO discounts (name, code, type, value, scope, min_purchase, min_quantity, start_date, end_date, usage_limit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [d.name, d.code, d.type, d.value, d.scope, d.minPurchase, d.minQuantity, d.startDate, d.endDate ?? null, d.usageLimit ?? null, userId],
      tx,
    );
    await writeTargets(tx, row!.id, d);
    return row!.id;
  }).catch(rethrowDuplicateCode);
  return serializeDiscount((await findDiscount(id))!);
}

export async function updateDiscount(id: number, body: unknown) {
  const patch = parse(updateDiscountSchema, body);
  return withTransaction(async (tx) => {
    // Lock the row so a concurrent billing run cannot bump used_count past a new limit.
    const existing = await queryOne<DiscountRow>(`${SELECT_DISCOUNT} WHERE d.id = $1 FOR UPDATE OF d`, [id], tx);
    if (!existing) throw notFound('Discount');
    const cur = serializeDiscount(existing);
    const merged: DiscountInput = {
      name: patch.name ?? cur.name,
      code: patch.code !== undefined ? patch.code : cur.code,
      type: patch.type ?? cur.type,
      value: patch.value ?? cur.value,
      scope: patch.scope ?? cur.scope,
      minPurchase: patch.minPurchase ?? cur.minPurchase,
      minQuantity: patch.minQuantity ?? cur.minQuantity,
      startDate: patch.startDate ?? cur.startDate,
      endDate: patch.endDate !== undefined ? patch.endDate : cur.endDate,
      usageLimit: patch.usageLimit !== undefined ? patch.usageLimit : cur.usageLimit,
      appliesToAll: patch.appliesToAll ?? (patch.targetIds ? false : cur.appliesToAll),
      targetIds: patch.targetIds ?? cur.targetIds,
    };
    if (merged.scope !== cur.scope && patch.targetIds === undefined && !merged.appliesToAll) {
      throw badRequest('VALIDATION_ERROR', 'Invalid discount', { fieldErrors: { targetIds: 'Pick new targets when changing scope' } });
    }
    checkRules(merged, existing.used_count);
    await checkTargetsExist(merged.scope, merged.appliesToAll ? [] : merged.targetIds);
    await tx
      .query(
        `UPDATE discounts SET name=$2, code=$3, type=$4, value=$5, scope=$6, min_purchase=$7, min_quantity=$8,
                start_date=$9, end_date=$10, usage_limit=$11 WHERE id=$1`,
        [id, merged.name, merged.code, merged.type, merged.value, merged.scope, merged.minPurchase, merged.minQuantity,
          merged.startDate, merged.endDate ?? null, merged.usageLimit ?? null],
      )
      .catch(rethrowDuplicateCode);
    await writeTargets(tx, id, merged);
    return serializeDiscount((await findDiscount(id, tx))!);
  });
}

export async function setDiscountActive(id: number, isActive: boolean) {
  const res = await pool.query('UPDATE discounts SET is_active = $2 WHERE id = $1', [id, isActive]);
  if (!res.rowCount) throw notFound('Discount');
  return serializeDiscount((await findDiscount(id))!);
}

/** Hard delete only when never used; otherwise deactivate so old invoices stay explainable. */
export async function deleteDiscount(id: number) {
  const d = await queryOne<{ used_count: number; usages: number }>(
    `SELECT used_count, (SELECT count(*)::int FROM discount_usages WHERE discount_id = $1) AS usages FROM discounts WHERE id = $1`,
    [id],
  );
  if (!d) throw notFound('Discount');
  if (d.used_count > 0 || d.usages > 0) {
    throw conflict('DISCOUNT_IN_USE', 'This discount has been used on invoices. Deactivate it instead.');
  }
  await pool.query('DELETE FROM discounts WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------
// Billing integration: applyDiscounts / recordDiscountUsage / releaseDiscountUsage
// ---------------------------------------------------------------------------

function toRule(d: DiscountRow): DiscountRule {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    value: d.type === 'PERCENT' ? Number(d.value) : toCents(d.value),
    scope: d.scope,
    minPurchaseCents: toCents(d.min_purchase),
    minQuantity: d.min_quantity,
    startDate: d.start_date,
    endDate: d.end_date,
    usageLimit: d.usage_limit,
    usedCount: d.used_count,
    isActive: d.is_active,
    targetIds: d.target_ids,
  };
}

export interface ApplyDiscountsInput {
  subscriptionId: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  lines: { lineId: string; productId: string; quantity: number; unitPrice: number | string }[];
}

/**
 * Called by the billing job while building a draft invoice. Reads discounts,
 * writes nothing. Pass the billing transaction's client as `db` to read inside it.
 */
export async function applyDiscounts(input: ApplyDiscountsInput, db: Db = pool) {
  const rows = await query<DiscountRow>(
    `${SELECT_DISCOUNT}
      WHERE d.is_active AND d.start_date <= $1 AND (d.end_date IS NULL OR d.end_date >= $1)
        AND (d.usage_limit IS NULL OR d.used_count < d.usage_limit)`,
    [input.invoiceDate],
    db,
  );
  const result = calculateDiscounts({
    subscriptionId: input.subscriptionId,
    invoiceDate: input.invoiceDate,
    lines: input.lines.map((l) => ({ lineId: l.lineId, productId: l.productId, quantity: l.quantity, unitPriceCents: toCents(l.unitPrice) })),
    discounts: rows.map(toRule),
  });
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return {
    subtotal: fromCents(result.subtotalCents),
    lines: result.lines.map((l) => ({
      lineId: l.lineId,
      subtotal: fromCents(l.subtotalCents),
      discountId: l.discountId,
      discountName: l.discountId ? names.get(l.discountId) ?? null : null,
      productDiscountAmount: fromCents(l.productDiscountCents),
      invoiceDiscountShare: fromCents(l.invoiceDiscountShareCents),
      discountAmount: fromCents(l.discountCents),
      netAmount: fromCents(l.netCents),
    })),
    invoiceDiscount: result.invoiceDiscount
      ? {
          discountId: result.invoiceDiscount.discountId,
          discountName: names.get(result.invoiceDiscount.discountId) ?? null,
          amount: fromCents(result.invoiceDiscount.amountCents),
        }
      : null,
    discountTotal: fromCents(result.discountTotalCents),
    netTotal: fromCents(result.netTotalCents),
    /** Pass this straight to recordDiscountUsage(). */
    discountsUsed: result.used.map((u) => ({ discountId: u.discountId, amount: fromCents(u.amountCents) })),
  };
}

export class DiscountLimitReachedError extends HttpError {
  constructor(public discountId: number) {
    super(409, 'DISCOUNT_LIMIT_REACHED', `Discount ${discountId} reached its usage limit`, { discountId });
  }
}

/**
 * Call inside the SAME transaction that inserts the invoice. Idempotent per
 * (discount, invoice). Throws DiscountLimitReachedError if a concurrent run
 * took the last slot: roll back and rebuild the invoice without that discount.
 */
export async function recordDiscountUsage(tx: Tx, invoiceId: string, used: { discountId: number; amount: number }[]) {
  for (const u of used) {
    const inserted = await tx.query(
      `INSERT INTO discount_usages (discount_id, invoice_id, amount) VALUES ($1, $2, $3)
       ON CONFLICT (discount_id, invoice_id) DO NOTHING`,
      [u.discountId, invoiceId, centsToSql(toCents(u.amount))],
    );
    if (inserted.rowCount === 0) continue; // already counted for this invoice
    // Conditional increment: row-level lock + WHERE means only one concurrent caller can take the last slot.
    const updated = await tx.query(
      `UPDATE discounts SET used_count = used_count + 1
        WHERE id = $1 AND is_active AND (usage_limit IS NULL OR used_count < usage_limit)`,
      [u.discountId],
    );
    if (updated.rowCount === 0) throw new DiscountLimitReachedError(u.discountId);
  }
}

/** Call when an invoice is cancelled. Frees the usage slots it held. */
export async function releaseDiscountUsage(tx: Tx, invoiceId: string) {
  const released = await tx.query<{ discount_id: number }>(
    'DELETE FROM discount_usages WHERE invoice_id = $1 RETURNING discount_id',
    [invoiceId],
  );
  for (const r of released.rows) {
    await tx.query('UPDATE discounts SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [r.discount_id]);
  }
  return released.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Preview (demo + UI): what would the next invoice for this subscription get?
// ---------------------------------------------------------------------------

export const previewSchema = z.object({
  subscriptionId: z.string().uuid('Pick a subscription'),
  date: dateStr.optional(),
});

export async function previewDiscounts(body: unknown) {
  const { subscriptionId, date } = parse(previewSchema, body);
  const sub = await queryOne(
    `SELECT s.id, s.subscription_number, s.status, pl.name AS plan_name, p.id AS customer_id, p.full_name
       FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id JOIN profiles p ON p.id = s.customer_id
      WHERE s.id = $1`,
    [subscriptionId],
  );
  if (!sub) throw notFound('Subscription');
  const lines = await query(
    `SELECT l.id, l.product_id, l.quantity, l.unit_price, pr.name AS product_name
       FROM subscription_items l JOIN products pr ON pr.id = l.product_id
      WHERE l.subscription_id = $1 ORDER BY pr.name, l.id`,
    [subscriptionId],
  );
  const invoiceDate = date ?? todayStr();
  const result = await applyDiscounts({
    subscriptionId,
    invoiceDate,
    lines: lines.map((l) => ({ lineId: String(l.id), productId: l.product_id, quantity: l.quantity, unitPrice: l.unit_price })),
  });
  const info = new Map(lines.map((l) => [String(l.id), l]));
  return {
    subscription: { id: sub.id, number: sub.subscription_number, status: sub.status, plan: sub.plan_name, customer: { id: sub.customer_id, name: sub.full_name } },
    invoiceDate,
    ...result,
    lines: result.lines.map((l) => {
      const li = info.get(l.lineId)!;
      return { ...l, productId: li.product_id, productName: li.product_name, quantity: li.quantity, unitPrice: money(li.unit_price) };
    }),
  };
}
