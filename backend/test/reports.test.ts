import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/payments/lib/db.js';
import { as, makeInvoice, makeWorld, resetDb } from './helpers.js';

let w: Awaited<ReturnType<typeof makeWorld>>;
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});
afterAll(() => pool.end());

describe('overdue and reports', () => {
  it('detects overdue invoices into aging buckets', async () => {
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 100, dueDaysAgo: 5 }); // 1-30
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 200, dueDaysAgo: 45 }); // 31-60
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 300, dueDaysAgo: 120, invoiceDaysAgo: 135 }); // 90+
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 400, dueDaysAgo: -3 }); // not due yet
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 500, dueDaysAgo: 10, status: 'paid' });
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 600, dueDaysAgo: 10, status: 'draft' });
    const partial = await makeInvoice({ customer: w.customer, sub: w.sub, total: 1000, dueDaysAgo: 70 }); // 61-90
    await as(w.staff).post('/payments', { invoiceId: partial, amount: 250, method: 'CARD', idempotencyKey: 'rep-test-1' });

    const r = await as(w.staff).get('/invoices/overdue');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    expect(r.body.buckets).toEqual([
      { bucket: '1-30', count: 1, amount: 100 },
      { bucket: '31-60', count: 1, amount: 200 },
      { bucket: '61-90', count: 1, amount: 750 },
      { bucket: '90+', count: 1, amount: 300 },
    ]);
    expect(r.body.items[0]).toMatchObject({ daysOverdue: 120, outstanding: 300 });
    const b = await as(w.staff).get('/invoices/overdue?bucket=61-90');
    expect(b.body.items).toHaveLength(1);
    expect(b.body.items[0]).toMatchObject({ amountPaid: 250, outstanding: 750 });

    const aging = (await as(w.staff).get('/reports/aging')).body;
    expect(aging.find((a: any) => a.bucket === 'CURRENT')).toEqual({ bucket: 'CURRENT', count: 1, amount: 400 });
  });

  it('summary aggregates invoiced, collected, outstanding and MRR', async () => {
    await makeInvoice({ customer: w.customer, sub: w.sub, total: 100, dueDaysAgo: 2, invoiceDaysAgo: 5 });
    const inv = await makeInvoice({ customer: w.customer, sub: w.sub, total: 300, invoiceDaysAgo: 3 });
    await as(w.staff).post('/payments', { invoiceId: inv, amount: 300, method: 'UPI', idempotencyKey: 'rep-test-2' });

    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const s = (await as(w.admin).get(`/reports/summary?from=${from}`)).body;
    expect(s).toMatchObject({
      activeSubscriptions: 1,
      mrr: 700, // 6x100 + 2x50, monthly
      invoicedAmount: 400,
      collectedAmount: 300,
      outstandingAmount: 100,
      overdueCount: 1,
      overdueAmount: 100,
    });
    const dash = await as(w.admin).get(`/reports/dashboard?from=${from}&granularity=week`);
    expect(dash.status).toBe(200);
    expect(dash.headers['x-response-time']).toMatch(/ms$/);
    expect(dash.body.byMethod).toEqual([{ method: 'UPI', amount: 300, count: 1 }]);
    expect(dash.body.topOutstanding[0]).toMatchObject({ outstanding: 100 });
  });
});
