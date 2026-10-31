// Products, plans, quotation templates and tax rules. Internal users can read; only admins write.
import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTransaction } from '../payments/lib/db.js';
import { asyncHandler, parse, uuidParam } from '../payments/lib/http.js';
import { conflict, notFound } from '../payments/lib/errors.js';
import { requireRole } from '../payments/middleware/auth.js';

export const catalogRouter = Router();
catalogRouter.use(requireRole('ADMIN', 'STAFF'));
const admin = requireRole('ADMIN');

const money = z.coerce.number().min(0).max(9_999_999_999);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null));

const remove = (table: string) => asyncHandler(async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [uuidParam(req)]);
    if (!result.rowCount) throw notFound('Item');
    res.status(204).end();
  } catch (err: any) {
    if (err.code === '23503') throw conflict('IN_USE', 'This item is used elsewhere, so it cannot be deleted.');
    throw err;
  }
});

// --- products -----------------------------------------------------------------
const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['Software', 'Service', 'Other']).default('Software'),
  description: z.string().max(2000).default(''),
  price: money,
  cost: money.default(0),
  variants: z.array(z.object({ name: z.string().trim().min(1).max(120), priceAdjustment: z.coerce.number() })).default([]),
}).refine((p) => p.variants.every((v) => p.price + v.priceAdjustment >= 0), 'A variant cannot make the price negative')
  .refine((p) => new Set(p.variants.map((v) => v.name.toLowerCase())).size === p.variants.length, 'Variant names must be unique');

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.type, p.description, p.price::float AS price, p.cost::float AS cost,
         COALESCE(json_agg(json_build_object('id', v.id, 'name', v.name, 'priceAdjustment', v.price_adjustment::float) ORDER BY v.name)
                  FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
    FROM products p LEFT JOIN product_variants v ON v.product_id = p.id`;

catalogRouter.get('/products', asyncHandler(async (_req, res) => {
  res.json(await query(`${PRODUCT_SELECT} GROUP BY p.id ORDER BY p.created_at DESC LIMIT 500`));
}));

async function saveProduct(body: unknown, id?: string) {
  const b = parse(productSchema, body);
  return withTransaction(async (tx) => {
    const row = id
      ? await queryOne('UPDATE products SET name=$1, type=$2, description=$3, price=$4, cost=$5, updated_at=now() WHERE id=$6 RETURNING id', [b.name, b.type, b.description, b.price, b.cost, id], tx)
      : await queryOne('INSERT INTO products (name, type, description, price, cost) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b.name, b.type, b.description, b.price, b.cost], tx);
    if (!row) throw notFound('Product');
    // Keep variant ids stable, and never remove one a subscription still uses.
    await tx.query(
      `DELETE FROM product_variants WHERE product_id = $1 AND NOT (name = ANY($2))
         AND id NOT IN (SELECT product_variant_id FROM subscription_items WHERE product_variant_id IS NOT NULL)`,
      [row.id, b.variants.map((v) => v.name)],
    );
    for (const v of b.variants) {
      await tx.query(
        `INSERT INTO product_variants (product_id, name, price_adjustment) VALUES ($1,$2,$3)
         ON CONFLICT (product_id, name) DO UPDATE SET price_adjustment = excluded.price_adjustment`,
        [row.id, v.name, v.priceAdjustment],
      );
    }
    return queryOne(`${PRODUCT_SELECT} WHERE p.id = $1 GROUP BY p.id`, [row.id], tx);
  });
}
catalogRouter.post('/products', admin, asyncHandler(async (req, res) => { res.status(201).json(await saveProduct(req.body)); }));
catalogRouter.patch('/products/:id', admin, asyncHandler(async (req, res) => { res.json(await saveProduct(req.body, uuidParam(req))); }));
catalogRouter.delete('/products/:id', admin, remove('products'));

// --- plans --------------------------------------------------------------------
const planSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: money,
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  minQuantity: z.coerce.number().int().min(1).default(1),
  startsAt: date,
  endsAt: date,
  autoClose: z.boolean().default(false),
  allowPause: z.boolean().default(true),
  allowEarlyClose: z.boolean().default(true),
  allowRenew: z.boolean().default(true),
  productIds: z.array(z.string().uuid()).default([]),
}).refine((p) => !p.startsAt || !p.endsAt || p.endsAt >= p.startsAt, 'The end date must be after the start date');

const PLAN_SELECT = `
  SELECT pl.id, pl.name, pl.price::float AS price, pl.frequency, pl.min_quantity AS "minQuantity",
         pl.starts_at AS "startsAt", pl.ends_at AS "endsAt", pl.auto_close AS "autoClose", pl.allow_pause AS "allowPause",
         pl.allow_early_close AS "allowEarlyClose", pl.allow_renew AS "allowRenew",
         COALESCE(array_agg(pp.product_id) FILTER (WHERE pp.product_id IS NOT NULL), '{}') AS "productIds"
    FROM plans pl LEFT JOIN plan_products pp ON pp.plan_id = pl.id`;

catalogRouter.get('/plans', asyncHandler(async (_req, res) => {
  res.json(await query(`${PLAN_SELECT} GROUP BY pl.id ORDER BY pl.created_at DESC LIMIT 500`));
}));

async function savePlan(body: unknown, id?: string) {
  const b = parse(planSchema, body);
  const values = [b.name, b.price, b.frequency, b.minQuantity, b.startsAt ?? null, b.endsAt ?? null, b.autoClose, b.allowPause, b.allowEarlyClose, b.allowRenew];
  return withTransaction(async (tx) => {
    const row = id
      ? await queryOne('UPDATE plans SET name=$1, price=$2, frequency=$3, min_quantity=$4, starts_at=$5, ends_at=$6, auto_close=$7, allow_pause=$8, allow_early_close=$9, allow_renew=$10, updated_at=now() WHERE id=$11 RETURNING id', [...values, id], tx)
      : await queryOne('INSERT INTO plans (name, price, frequency, min_quantity, starts_at, ends_at, auto_close, allow_pause, allow_early_close, allow_renew) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', values, tx);
    if (!row) throw notFound('Plan');
    await tx.query('DELETE FROM plan_products WHERE plan_id = $1', [row.id]);
    for (const productId of new Set(b.productIds)) await tx.query('INSERT INTO plan_products (plan_id, product_id) VALUES ($1,$2)', [row.id, productId]);
    return queryOne(`${PLAN_SELECT} WHERE pl.id = $1 GROUP BY pl.id`, [row.id], tx);
  });
}
catalogRouter.post('/plans', admin, asyncHandler(async (req, res) => { res.status(201).json(await savePlan(req.body)); }));
catalogRouter.patch('/plans/:id', admin, asyncHandler(async (req, res) => { res.json(await savePlan(req.body, uuidParam(req))); }));
catalogRouter.delete('/plans/:id', admin, remove('plans'));

// --- quotation templates ------------------------------------------------------
const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  validityDays: z.coerce.number().int().min(1).default(30),
  planId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
  lineItems: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
    quantity: z.coerce.number().positive(),
    taxRuleId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
  })).default([]),
});

const TEMPLATE_SELECT = `SELECT id, name, validity_days AS "validityDays", plan_id AS "planId", line_items AS "lineItems" FROM quotation_templates`;

catalogRouter.get('/templates', asyncHandler(async (_req, res) => {
  res.json(await query(`${TEMPLATE_SELECT} ORDER BY created_at DESC LIMIT 500`));
}));
async function saveTemplate(body: unknown, id?: string) {
  const b = parse(templateSchema, body);
  const values = [b.name, b.validityDays, b.planId ?? null, JSON.stringify(b.lineItems)];
  const row = id
    ? await queryOne('UPDATE quotation_templates SET name=$1, validity_days=$2, plan_id=$3, line_items=$4, updated_at=now() WHERE id=$5 RETURNING id', [...values, id])
    : await queryOne('INSERT INTO quotation_templates (name, validity_days, plan_id, line_items) VALUES ($1,$2,$3,$4) RETURNING id', values);
  if (!row) throw notFound('Template');
  return queryOne(`${TEMPLATE_SELECT} WHERE id = $1`, [row.id]);
}
catalogRouter.post('/templates', admin, asyncHandler(async (req, res) => { res.status(201).json(await saveTemplate(req.body)); }));
catalogRouter.patch('/templates/:id', admin, asyncHandler(async (req, res) => { res.json(await saveTemplate(req.body, uuidParam(req))); }));
catalogRouter.delete('/templates/:id', admin, remove('quotation_templates'));

// --- tax rules ----------------------------------------------------------------
const taxSchema = z.object({
  name: z.string().trim().min(1).max(100),
  taxRate: z.coerce.number().min(0).max(100),
  description: z.string().max(500).default(''),
  isActive: z.boolean().default(true),
});
const TAX_SELECT = `SELECT id, name, tax_rate::float AS "taxRate", description, is_active AS "isActive" FROM tax_rules`;

catalogRouter.get('/taxes', asyncHandler(async (_req, res) => { res.json(await query(`${TAX_SELECT} ORDER BY name`)); }));
catalogRouter.post('/taxes', admin, asyncHandler(async (req, res) => {
  const b = parse(taxSchema, req.body);
  const row = await queryOne('INSERT INTO tax_rules (name, tax_rate, description, is_active) VALUES ($1,$2,$3,$4) RETURNING id', [b.name, b.taxRate, b.description, b.isActive]);
  res.status(201).json(await queryOne(`${TAX_SELECT} WHERE id = $1`, [row.id]));
}));
catalogRouter.patch('/taxes/:id', admin, asyncHandler(async (req, res) => {
  const b = parse(taxSchema, req.body);
  const id = uuidParam(req);
  const row = await queryOne('UPDATE tax_rules SET name=$1, tax_rate=$2, description=$3, is_active=$4 WHERE id=$5 RETURNING id', [b.name, b.taxRate, b.description, b.isActive, id]);
  if (!row) throw notFound('Tax rule');
  res.json(await queryOne(`${TAX_SELECT} WHERE id = $1`, [id]));
}));
catalogRouter.delete('/taxes/:id', admin, remove('tax_rules'));
