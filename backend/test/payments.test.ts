import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { pool } from '../src/payments/lib/db.js';
import { addDays, todayStr } from '../src/payments/lib/dates.js';
import { randomUUID } from 'node:crypto';
import { API, app, as, invoiceStatus, makeInvoice, makeWorld, resetDb } from './helpers.js';

let w: Awaited<ReturnType<typeof makeWorld>>;
let key = 0;
const k = () => `test-key-${Date.now()}-${++key}`;
const pay = (user: string, invoiceId: string, amount: number | string, extra: object = {}) =>
  as(user).post('/payments', { invoiceId, amount, method: 'CASH', idempotencyKey: k(), ...extra });

beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => pool.end());

describe('recording payments', () => {
  it('partial payment keeps the invoice Confirmed, the rest flips it to Paid', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 1180 });
    const r1 = await pay(w.staff, inv, 500);
    expect(r1.status).toBe(201);
    expect(r1.body.invoice).toMatchObject({ amountPaid: 500, outstanding: 680, status: 'confirmed', isPartiallyPaid: true });

    const r2 = await pay(w.staff, inv, '680.00');
    expect(r2.status).toBe(201);
    expect(r2.body.invoice).toMatchObject({ amountPaid: 1180, outstanding: 0, status: 'paid' });
  });

  it('rejects overpayment with the outstanding amount', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 1180 });
    await pay(w.staff, inv, 200);
    const r = await pay(w.staff, inv, 980.01);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('OVERPAYMENT');
    expect(r.body.error.message).toContain('980.00');
    expect(r.body.error.details.outstanding).toBe(980);
  });

  it('validates amount, decimals and date', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    expect((await pay(w.staff, inv, 0)).status).toBe(400);
    expect((await pay(w.staff, inv, -5)).status).toBe(400);
    expect((await pay(w.staff, inv, 1.005)).status).toBe(400);
    expect((await pay(w.staff, inv, 10, { paymentDate: addDays(todayStr(), 1) })).status).toBe(400);
    expect((await pay(w.staff, inv, 10, { method: 'BITCOIN' })).status).toBe(400);
  });

  it('refuses Draft, Paid and Cancelled invoices with 409', async () => {
    for (const status of ['draft', 'paid', 'cancelled']) {
      const inv = await makeInvoice({ customer: w.customer, total: 100, status });
      const r = await pay(w.staff, inv, 10);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    }
    expect((await pay(w.staff, randomUUID(), 10)).status).toBe(404);
  });

  it('is idempotent: the same key returns the first payment', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    const idempotencyKey = k();
    const r1 = await pay(w.staff, inv, 40, { idempotencyKey });
    const r2 = await pay(w.staff, inv, 40, { idempotencyKey });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBe(true);
    expect(r2.body.payment.id).toBe(r1.body.payment.id);
    expect(r2.body.invoice.amountPaid).toBe(40);

    const reused = await pay(w.staff, inv, 41, { idempotencyKey });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a burst of double-clicks with one key creates exactly one payment', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    const idempotencyKey = k();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(w.staff, inv, 100, { idempotencyKey })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM payments WHERE invoice_id = $1', [inv]);
    expect(rows[0].n).toBe(1);
    expect(await invoiceStatus(inv)).toBe('paid');
  });

  it('two staff paying the full amount at once: row lock lets only one through', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    const [a, b] = await Promise.all([pay(w.staff, inv, 100), pay(w.admin, inv, 100)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]); // overpayment, or already Paid
    const { rows } = await pool.query(`SELECT COALESCE(SUM(amount),0)::float AS s FROM payments WHERE invoice_id = $1`, [inv]);
    expect(rows[0].s).toBe(100);
  });
});

describe('voiding', () => {
  it('voids, reopens a Paid invoice, and keeps the row', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100, dueDaysAgo: 3 });
    const p = await pay(w.staff, inv, 100);
    expect(await invoiceStatus(inv)).toBe('paid');

    const v = await as(w.admin).post(`/payments/${p.body.payment.id}/void`, { reason: 'Cheque bounced' });
    expect(v.status).toBe(200);
    expect(v.body.payment).toMatchObject({ status: 'VOIDED', voidReason: 'Cheque bounced' });
    expect(v.body.invoice).toMatchObject({ status: 'confirmed', outstanding: 100, isOverdue: true, daysOverdue: 3 });

    expect((await as(w.admin).post(`/payments/${p.body.payment.id}/void`, { reason: 'again' })).status).toBe(409);
  });

  it('requires a reason and admin role', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    const p = await pay(w.staff, inv, 10);
    expect((await as(w.admin).post(`/payments/${p.body.payment.id}/void`, {})).status).toBe(400);
    expect((await as(w.staff).post(`/payments/${p.body.payment.id}/void`, { reason: 'nope' })).status).toBe(403);
  });
});

describe('roles and customer isolation', () => {
  it('blocks unauthenticated and customer writes', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 100 });
    expect((await request(app).get(API + '/payments')).status).toBe(401);
    expect((await pay(w.customer, inv, 10)).status).toBe(403);
    expect((await as(w.customer).get('/payments')).status).toBe(403);
    expect((await as(w.customer).get('/reports/summary')).status).toBe(403);
  });

  it('customers see only their own balance and payments', async () => {
    const mine = await makeInvoice({ customer: w.customer, total: 100 });
    const theirs = await makeInvoice({ customer: w.otherCustomer, total: 100 });
    await pay(w.staff, mine, 30);
    await pay(w.staff, theirs, 40);

    expect((await as(w.customer).get(`/invoices/${mine}/balance`)).body.outstanding).toBe(70);
    expect((await as(w.customer).get(`/invoices/${theirs}/balance`)).status).toBe(404);

    const me = await as(w.customer).get('/me/payments');
    expect(me.status).toBe(200);
    expect(me.body.items).toHaveLength(1);
    expect(me.body.items[0].amount).toBe(30);
    expect((await as(w.staff).get('/me/payments')).status).toBe(403);
  });

  it('accepts a Supabase JWT and takes the role from profiles, not the token', async () => {
    const token = await new SignJWT({ role: 'authenticated', user_role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(w.customer)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get(API + '/me/payments').set(auth)).status).toBe(200);
    expect((await request(app).get(API + '/payments').set(auth)).status).toBe(403);
    expect((await request(app).get(API + '/me/payments').set({ Authorization: 'Bearer junk' })).status).toBe(401);
  });
});

describe('history', () => {
  it('filters and totals posted payments only', async () => {
    const inv = await makeInvoice({ customer: w.customer, total: 1000 });
    await pay(w.staff, inv, 100, { method: 'UPI' });
    const p2 = await pay(w.staff, inv, 200, { method: 'CARD' });
    await as(w.admin).post(`/payments/${p2.body.payment.id}/void`, { reason: 'duplicate entry' });

    const all = await as(w.staff).get('/payments');
    expect(all.body.total).toBe(2);
    expect(all.body.postedAmount).toBe(100);
    const upi = await as(w.staff).get('/payments?method=UPI');
    expect(upi.body.items).toHaveLength(1);
  });
});
