import { beforeEach, describe, expect, it } from 'vitest';
import { pool, queryOne } from '../src/payments/lib/db.js';
import { addDays, todayStr } from '../src/payments/lib/dates.js';
import { nextPeriodStart } from '../src/billing/shared.js';
import { as, makeUser, resetDb } from './helpers.js';

let admin: string, staff: string, customer: string, other: string, productId: string, planId: string, taxId: string;

async function activeSub(body: object = {}) {
  const start = addDays(todayStr(), -5);
  const created = await as(staff).post('/subscriptions', {
    customerId: customer, planId, startDate: start,
    lines: [{ productId, quantity: 6, taxRuleId: taxId }],
    ...body,
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  for (const status of ['quotation', 'confirmed', 'active']) {
    expect((await as(staff).post(`/subscriptions/${id}/status`, { status })).status).toBe(200);
  }
  return id;
}

beforeEach(async () => {
  await resetDb();
  await pool.query('TRUNCATE tax_rules, quotation_templates, number_series, subscription_events CASCADE');
  admin = await makeUser('admin');
  staff = await makeUser('staff');
  customer = await makeUser('customer', 'Cust One');
  other = await makeUser('customer', 'Cust Two');
  productId = (await as(admin).post('/catalog/products', { name: 'Seat', price: 100, variants: [{ name: 'Odoo', priceAdjustment: 560 }] })).body.id;
  planId = (await as(admin).post('/catalog/plans', { name: 'Monthly', price: 100, frequency: 'monthly', minQuantity: 1 })).body.id;
  taxId = (await as(admin).post('/catalog/taxes', { name: 'GST', taxRate: 18 })).body.id;
});

describe('catalog', () => {
  it('admins write, staff read only, customers get nothing', async () => {
    expect((await as(staff).get('/catalog/products')).body[0].variants[0]).toMatchObject({ name: 'Odoo', priceAdjustment: 560 });
    expect((await as(staff).post('/catalog/products', { name: 'X', price: 1 })).status).toBe(403);
    expect((await as(customer).get('/catalog/products')).status).toBe(403);
  });

  it('variant price is added to the line, and in-use products cannot be deleted', async () => {
    const variantId = (await as(staff).get('/catalog/products')).body[0].variants[0].id;
    const sub = await as(staff).post('/subscriptions', { customerId: customer, planId, startDate: todayStr(), lines: [{ productId, variantId, quantity: 1 }] });
    expect(sub.body.lines[0]).toMatchObject({ description: 'Seat (Odoo)', unitPrice: 660 });
    expect((await as(admin).delete(`/catalog/products/${productId}`)).status).toBe(409);
  });
});

describe('subscription lifecycle', () => {
  it('numbers subscriptions and records history', async () => {
    const id = await activeSub();
    const sub = (await as(staff).get(`/subscriptions/${id}`)).body;
    expect(sub.number).toBe(`SUB/${addDays(todayStr(), -5).slice(0, 4)}/0001`);
    expect(sub.events.map((e: any) => e.to)).toEqual(['draft', 'quotation', 'confirmed', 'active']);
  });

  it('blocks illegal jumps', async () => {
    const created = await as(staff).post('/subscriptions', { customerId: customer, planId, startDate: todayStr(), lines: [{ productId, quantity: 1 }] });
    const jump = await as(staff).post(`/subscriptions/${created.body.id}/status`, { status: 'active' });
    expect(jump.status).toBe(409);
    expect(jump.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('builds a quotation from a template and enforces minimum quantity', async () => {
    const template = await as(admin).post('/catalog/templates', { name: 'Team', validityDays: 10, planId, lineItems: [{ productId, quantity: 2 }] });
    const sub = await as(staff).post('/subscriptions', { customerId: customer, templateId: template.body.id, startDate: todayStr() });
    expect(sub.body).toMatchObject({ status: 'quotation', quoteExpiresOn: addDays(todayStr(), 10) });
    const strict = (await as(admin).post('/catalog/plans', { name: 'Big', price: 1, frequency: 'monthly', minQuantity: 5 })).body.id;
    const small = await as(staff).post('/subscriptions', { customerId: customer, planId: strict, startDate: todayStr(), lines: [{ productId, quantity: 2 }] });
    expect(small.body.error.code).toBe('BELOW_MIN_QUANTITY');
  });
});

describe('billing run', () => {
  it('creates a draft invoice with tax, and a second run creates nothing', async () => {
    await activeSub();
    const first = await as(admin).post('/billing/run', { date: todayStr() });
    expect(first.body).toMatchObject({ invoicesCreated: 1, failed: 0 });
    const list = (await as(staff).get('/invoices')).body;
    expect(list.items[0]).toMatchObject({ status: 'draft', subtotal: 600, taxAmount: 108, total: 708 });
    const second = await as(admin).post('/billing/run', { date: todayStr() });
    expect(second.body).toMatchObject({ subscriptions: 0, invoicesCreated: 0 });
    expect((await as(staff).get('/invoices')).body.total).toBe(1);
  });

  it('catches up every missed period and never repeats a period already invoiced', async () => {
    const id = await activeSub({ startDate: '2026-01-31', paymentTermsDays: 7 });
    const run = await as(admin).post('/billing/run', { date: '2026-04-01' });
    expect(run.body.invoicesCreated).toBe(3);
    await pool.query(`UPDATE subscriptions SET next_billing_date = '2026-02-28' WHERE id = $1`, [id]);
    const again = await as(admin).post('/billing/run', { date: '2026-04-01' });
    expect(again.body).toMatchObject({ invoicesCreated: 0, duplicatesSkipped: 2 });
    const dates = (await as(staff).get('/invoices')).body.items.map((i: any) => i.invoiceDate).sort();
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('applies a discount once when its limit is 1, tax on the discounted amount', async () => {
    await as(admin).post('/discounts', { name: 'Ten off', type: 'PERCENT', value: 10, scope: 'SUBSCRIPTION', startDate: addDays(todayStr(), -30), usageLimit: 1 });
    await activeSub({ startDate: addDays(todayStr(), -40) });
    await as(admin).post('/billing/run', { date: todayStr() });
    const rows = (await as(staff).get('/invoices')).body.items.sort((a: any, b: any) => a.invoiceDate.localeCompare(b.invoiceDate));
    expect(rows).toHaveLength(2);
    const discounted = rows.filter((r: any) => r.discountAmount > 0);
    expect(discounted).toHaveLength(1);
    expect(discounted[0]).toMatchObject({ discountAmount: 60, taxAmount: 97.2, total: 637.2 });
  });

  it('skips paused subscriptions and does not bill the paused time on resume', async () => {
    const id = await activeSub({ startDate: addDays(todayStr(), -70) });
    await as(staff).post(`/subscriptions/${id}/status`, { status: 'paused' });
    expect((await as(admin).post('/billing/run', { date: todayStr() })).body.invoicesCreated).toBe(0);
    await as(staff).post(`/subscriptions/${id}/status`, { status: 'active' });
    expect((await as(staff).get(`/subscriptions/${id}`)).body.nextBillingDate >= todayStr()).toBe(true);
  });

  it('auto-closes at the end of the term when the plan says so', async () => {
    const closing = (await as(admin).post('/catalog/plans', { name: 'Term', price: 1, frequency: 'monthly', autoClose: true })).body.id;
    const id = await activeSub({ planId: closing, startDate: '2026-01-01', endDate: '2026-02-15' });
    const run = await as(admin).post('/billing/run', { date: '2026-06-01' });
    expect(run.body).toMatchObject({ invoicesCreated: 2, closed: 1 });
    expect((await as(staff).get(`/subscriptions/${id}`)).body.status).toBe('closed');
  });

  it('only admins can start a run', async () => {
    expect((await as(staff).post('/billing/run')).status).toBe(403);
  });
});

describe('invoices', () => {
  async function draftInvoice() {
    await activeSub();
    await as(admin).post('/billing/run', { date: todayStr() });
    return (await as(staff).get('/invoices')).body.items[0].id as string;
  }

  it('confirm, then pay in two parts, becomes paid and cannot be cancelled', async () => {
    const id = await draftInvoice();
    expect((await as(staff).post(`/invoices/${id}/confirm`)).body.status).toBe('confirmed');
    for (const amount of [300, 408]) {
      const paid = await as(staff).post('/payments', { invoiceId: id, method: 'UPI', amount, paymentDate: todayStr() });
      expect(paid.status).toBe(201);
    }
    expect((await as(staff).get(`/invoices/${id}`)).body).toMatchObject({ status: 'paid', outstanding: 0 });
    expect((await as(staff).post(`/invoices/${id}/cancel`)).status).toBe(409);
  });

  it('cancelling frees the discount it used', async () => {
    const discount = await as(admin).post('/discounts', { name: 'Once', type: 'FIXED', value: 10, scope: 'SUBSCRIPTION', startDate: addDays(todayStr(), -30), usageLimit: 1 });
    const id = await draftInvoice();
    await as(staff).post(`/invoices/${id}/cancel`);
    expect((await queryOne('SELECT used_count FROM discounts WHERE id = $1', [discount.body.id]))!.used_count).toBe(0);
  });

  it('produces a PDF and refuses to send a draft', async () => {
    const id = await draftInvoice();
    expect((await as(staff).post(`/invoices/${id}/send`)).status).toBe(409);
    await as(staff).post(`/invoices/${id}/confirm`);
    expect((await as(staff).post(`/invoices/${id}/send`)).body.emailed).toBe(false);
    const pdf = await as(customer).get(`/invoices/${id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('customer portal', () => {
  it('shows only your own data, even with a real id', async () => {
    const id = await activeSub();
    await as(admin).post('/billing/run', { date: todayStr() });
    const invoiceId = (await as(staff).get('/invoices')).body.items[0].id;
    expect((await as(customer).get('/portal/invoices')).body.total).toBe(1);
    expect((await as(other).get('/portal/invoices')).body.total).toBe(0);
    expect((await as(other).get(`/portal/invoices/${invoiceId}`)).status).toBe(404);
    expect((await as(other).get(`/portal/subscriptions/${id}`)).status).toBe(404);
    expect((await as(other).get(`/invoices/${invoiceId}/pdf`)).status).toBe(404);
    expect((await as(other).post(`/portal/subscriptions/${id}/pause`)).status).toBe(404);
    expect((await as(customer).get('/invoices')).status).toBe(403);
    expect((await as(customer).get('/subscriptions')).status).toBe(403);
  });

  it('pause, resume and close follow the plan options', async () => {
    const id = await activeSub();
    expect((await as(customer).post(`/portal/subscriptions/${id}/pause`)).body.status).toBe('paused');
    expect((await as(customer).post(`/portal/subscriptions/${id}/resume`)).body.status).toBe('active');
    const strict = (await as(admin).post('/catalog/plans', { name: 'Fixed', price: 1, frequency: 'monthly', allowPause: false, allowEarlyClose: false })).body.id;
    const fixed = await activeSub({ planId: strict });
    expect((await as(customer).post(`/portal/subscriptions/${fixed}/pause`)).status).toBe(403);
    expect((await as(customer).post(`/portal/subscriptions/${fixed}/close`)).status).toBe(403);
  });

  it('accepts a quotation, and renews a closed subscription as a new one', async () => {
    const created = await as(staff).post('/subscriptions', { customerId: customer, planId, startDate: todayStr(), lines: [{ productId, quantity: 1 }] });
    await as(staff).post(`/subscriptions/${created.body.id}/status`, { status: 'quotation' });
    expect((await as(customer).post(`/portal/subscriptions/${created.body.id}/accept`)).body.status).toBe('confirmed');
    const id = await activeSub();
    await as(customer).post(`/portal/subscriptions/${id}/close`);
    const renewed = await as(customer).post(`/portal/subscriptions/${id}/renew`);
    expect(renewed.body).toMatchObject({ status: 'active', nextBillingDate: todayStr() });
    expect(renewed.body.id).not.toBe(id);
  });
});

describe('period dates', () => {
  it('keeps month-end billing on the month end', () => {
    expect(nextPeriodStart('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextPeriodStart('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(nextPeriodStart('2024-02-29', 'yearly', '2024-02-29')).toBe('2025-02-28');
  });
});
