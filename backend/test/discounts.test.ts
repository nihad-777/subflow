import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/payments/lib/db.js';
import { addDays, todayStr } from '../src/payments/lib/dates.js';
import { applyDiscounts, recordDiscountUsage, releaseDiscountUsage, DiscountLimitReachedError } from '../src/payments/modules/discounts/discount.service.js';
import { as, makeInvoice, makeWorld, resetDb } from './helpers.js';

let w: Awaited<ReturnType<typeof makeWorld>>;
const today = todayStr();
const base = () => ({
  name: '10% off for 5+ seats', type: 'PERCENT', value: 10, scope: 'PRODUCT', minQuantity: 5,
  startDate: addDays(today, -1), usageLimit: 1, targetIds: [w.product],
});

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => pool.end());

describe('discount CRUD and validation', () => {
  it('admin creates, staff reads but cannot write', async () => {
    const r = await as(w.admin).post('/discounts', base());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'ACTIVE', usedCount: 0, usageLimit: 1, targetIds: [w.product] });
    expect((await as(w.staff).get('/discounts')).body.total).toBe(1);
    expect((await as(w.staff).post('/discounts', base())).status).toBe(403);
    expect((await as(w.staff).patch(`/discounts/${r.body.id}`, { value: 5 })).status).toBe(403);
    expect((await as(w.customer).get('/discounts')).status).toBe(403);
  });

  it('rejects bad input with field errors', async () => {
    const bad = async (over: object) => (await as(w.admin).post('/discounts', { ...base(), ...over })).body.error;
    expect((await bad({ value: 101 })).details.fieldErrors.value).toBeTruthy();
    expect((await bad({ type: 'FIXED', value: 0 })).code).toBe('VALIDATION_ERROR');
    expect((await bad({ endDate: addDays(today, -5) })).details.fieldErrors.endDate).toBeTruthy();
    expect((await bad({ targetIds: [] })).details.fieldErrors.targetIds).toBeTruthy();
    expect((await bad({ targetIds: ['00000000-0000-4000-8000-999999999999'] })).details.fieldErrors.targetIds).toBeTruthy();
    expect((await bad({ usageLimit: 0 })).code).toBe('VALIDATION_ERROR');
    const ok = await as(w.admin).post('/discounts', { ...base(), targetIds: [], appliesToAll: true });
    expect(ok.status).toBe(201);
  });

  it('computes status and filters by it', async () => {
    await as(w.admin).post('/discounts', { ...base(), name: 'future', startDate: addDays(today, 3) });
    await as(w.admin).post('/discounts', { ...base(), name: 'old', startDate: addDays(today, -30), endDate: addDays(today, -1) });
    await as(w.admin).post('/discounts', base());
    const byStatus = async (s: string) => (await as(w.admin).get(`/discounts?status=${s}`)).body.items.map((d: any) => d.name);
    expect(await byStatus('scheduled')).toEqual(['future']);
    expect(await byStatus('expired')).toEqual(['old']);
    expect(await byStatus('active')).toEqual(['10% off for 5+ seats']);
  });

  it('cannot lower the limit below used count, and used discounts cannot be deleted', async () => {
    const d = (await as(w.admin).post('/discounts', { ...base(), usageLimit: 3 })).body;
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    const inv2 = await makeInvoice({ customer: w.customer, total: 100 });
    await withTransaction((tx) => recordDiscountUsage(tx, inv, [{ discountId: d.id, amount: 10 }]));
    await withTransaction((tx) => recordDiscountUsage(tx, inv2, [{ discountId: d.id, amount: 10 }]));
    expect((await as(w.admin).patch(`/discounts/${d.id}`, { usageLimit: 1 })).status).toBe(400);
    expect((await as(w.admin).patch(`/discounts/${d.id}`, { usageLimit: 2 })).status).toBe(200);
    expect((await as(w.admin).delete(`/discounts/${d.id}`)).status).toBe(409);
    expect((await as(w.admin).post(`/discounts/${d.id}/deactivate`)).body.status).toBe('INACTIVE');
  });
});

describe('billing integration', () => {
  it('preview shows the discount on the 6-seat line only', async () => {
    const d = (await as(w.admin).post('/discounts', base())).body;
    const r = await as(w.staff).post('/discounts/preview', { subscriptionId: w.sub });
    expect(r.status).toBe(200);
    expect(r.body.subtotal).toBe(700);
    // Line order is not guaranteed (uuid ids), so look the lines up by outcome.
    const lines = r.body.lines as { discountId: number | null; discountAmount: number; netAmount: number }[];
    expect(lines.find((l) => l.discountId === d.id)).toMatchObject({ discountAmount: 60, netAmount: 540 });
    expect(lines.find((l) => l.discountId === null)).toMatchObject({ discountAmount: 0 });
    expect(r.body.discountsUsed).toEqual([{ discountId: d.id, amount: 60 }]);
  });

  it('limit 1: second invoice no longer gets the discount', async () => {
    const d = (await as(w.admin).post('/discounts', base())).body;
    const input = { subscriptionId: w.sub, invoiceDate: today, lines: [{ lineId: '1', productId: w.product, quantity: 6, unitPrice: 100 }] };
    const first = await applyDiscounts(input);
    const inv = await makeInvoice({ customer: w.customer, total: 540 });
    await withTransaction((tx) => recordDiscountUsage(tx, inv, first.discountsUsed));
    expect((await applyDiscounts(input)).discountTotal).toBe(0);
    expect((await as(w.admin).get(`/discounts/${d.id}`)).body).toMatchObject({ status: 'EXHAUSTED', usedCount: 1 });
  });

  it('recording usage is idempotent per invoice and race-safe under concurrency', async () => {
    const d = (await as(w.admin).post('/discounts', base())).body;
    const invs = await Promise.all(Array.from({ length: 6 }, () => makeInvoice({ customer: w.customer, total: 100 })));
    const results = await Promise.allSettled(
      invs.map((inv) => withTransaction((tx) => recordDiscountUsage(tx, inv, [{ discountId: d.id, amount: 10 }]))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => r.reason instanceof DiscountLimitReachedError)).toBe(true);

    const winner = invs[results.findIndex((r) => r.status === 'fulfilled')];
    await withTransaction((tx) => recordDiscountUsage(tx, winner, [{ discountId: d.id, amount: 10 }])); // same invoice again: no-op
    const { rows } = await pool.query('SELECT used_count FROM discounts WHERE id = $1', [d.id]);
    expect(rows[0].used_count).toBe(1);

    // Cancelling the invoice frees the slot.
    expect(await withTransaction((tx) => releaseDiscountUsage(tx, winner))).toBe(1);
    expect((await as(w.admin).get(`/discounts/${d.id}`)).body).toMatchObject({ status: 'ACTIVE', usedCount: 0 });
  });
});
