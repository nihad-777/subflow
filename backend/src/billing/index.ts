// Subscriptions, billing and invoices. Mounted inside the /api/finance router, so it
// shares its sign-in check and error format.
import { Router, type Request } from 'express';
import { z } from 'zod';
import cron from 'node-cron';
import { asyncHandler, pagination, parse, uuidParam } from '../payments/lib/http.js';
import { queryOne } from '../payments/lib/db.js';
import { notFound } from '../payments/lib/errors.js';
import { todayStr } from '../payments/lib/dates.js';
import { requireRole } from '../payments/middleware/auth.js';
import { catalogRouter } from './catalog.routes.js';
import * as subs from './subscription.service.js';
import { runBilling } from './billing.service.js';
import * as invoices from './invoice.service.js';

const internal = requireRole('ADMIN', 'STAFF');
const filters = (req: Request) => req.query as Record<string, string | undefined>;
const PORTAL_ACTIONS = { accept: 'confirmed', pause: 'paused', resume: 'active', close: 'closed' } as const;

export function billingRouter() {
  const r = Router();
  r.use('/catalog', catalogRouter);

  // Dashboard cards. Customers only ever count their own records.
  r.get('/overview', asyncHandler(async (req, res) => {
    const customerId = req.user!.role === 'CUSTOMER' ? req.user!.id : null;
    res.json(await queryOne(
      `WITH open_invoices AS (
         SELECT i.due_date, i.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'POSTED'), 0) AS balance
           FROM invoices i WHERE i.status = 'confirmed' AND ($1::uuid IS NULL OR i.customer_id = $1)
       )
       SELECT (SELECT count(*)::int FROM subscriptions s WHERE s.status = 'active' AND ($1::uuid IS NULL OR s.customer_id = $1)) AS "activeSubscriptions",
              (SELECT count(*)::int FROM subscriptions s WHERE s.status = 'quotation' AND ($1::uuid IS NULL OR s.customer_id = $1)) AS quotations,
              (SELECT count(*)::int FROM invoices i WHERE i.status = 'draft' AND $1::uuid IS NULL) AS "draftInvoices",
              (SELECT count(*)::int FROM open_invoices WHERE balance > 0) AS "openInvoices",
              (SELECT count(*)::int FROM open_invoices WHERE balance > 0 AND due_date < CURRENT_DATE) AS "overdueInvoices",
              (SELECT COALESCE(SUM(balance), 0)::float FROM open_invoices WHERE balance > 0) AS outstanding`,
      [customerId],
    ));
  }));

  r.get('/subscriptions', internal, asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    const { status, q, customerId } = filters(req);
    res.json({ ...(await subs.listSubscriptions({ status, q, customerId, ...page })), page: page.page, pageSize: page.pageSize });
  }));
  r.post('/subscriptions', internal, asyncHandler(async (req, res) => { res.status(201).json(await subs.createSubscription(req.body, req.user!)); }));
  r.get('/subscriptions/:id', internal, asyncHandler(async (req, res) => { res.json(await subs.getSubscription(uuidParam(req), req.user!)); }));
  r.patch('/subscriptions/:id', internal, asyncHandler(async (req, res) => { res.json(await subs.updateSubscription(uuidParam(req), req.body, req.user!)); }));
  r.post('/subscriptions/:id/status', internal, asyncHandler(async (req, res) => {
    const b = parse(z.object({ status: z.enum(subs.STATUSES), note: z.string().max(300).optional() }), req.body);
    res.json(await subs.changeStatus(uuidParam(req), b.status, req.user!, b.note));
  }));
  r.post('/subscriptions/:id/renew', internal, asyncHandler(async (req, res) => { res.json(await subs.renewSubscription(uuidParam(req), req.user!)); }));

  r.post('/billing/run', requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
    res.json(await runBilling(b.date ?? todayStr()));
  }));

  r.get('/invoices', internal, asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    const { status, q, customerId } = filters(req);
    res.json({ ...(await invoices.listInvoices({ status, q, customerId, ...page })), page: page.page, pageSize: page.pageSize });
  }));
  r.get('/invoices/:id', internal, asyncHandler(async (req, res) => { res.json(await invoices.getInvoice(uuidParam(req), req.user!)); }));
  // Open to customers too: getInvoice refuses anyone else's invoice.
  r.get('/invoices/:id/pdf', asyncHandler(async (req, res) => {
    const inv = await invoices.getInvoice(uuidParam(req), req.user!);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.number.replaceAll('/', '-')}.pdf"`);
    res.end(await invoices.invoicePdf(inv));
  }));
  r.post('/invoices/:id/confirm', internal, asyncHandler(async (req, res) => { res.json(await invoices.confirmInvoice(uuidParam(req), req.user!)); }));
  r.post('/invoices/:id/cancel', internal, asyncHandler(async (req, res) => { res.json(await invoices.cancelInvoice(uuidParam(req), req.user!)); }));
  r.post('/invoices/:id/send', internal, asyncHandler(async (req, res) => { res.json(await invoices.sendInvoice(uuidParam(req), req.user!)); }));

  // Customer portal: always scoped to the signed-in customer.
  const portal = Router();
  portal.use(requireRole('CUSTOMER'));
  portal.get('/subscriptions', asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    res.json({ ...(await subs.listSubscriptions({ customerId: req.user!.id, hideDrafts: true, ...page })), page: page.page, pageSize: page.pageSize });
  }));
  portal.get('/subscriptions/:id', asyncHandler(async (req, res) => { res.json(await subs.getSubscription(uuidParam(req), req.user!)); }));
  portal.post('/subscriptions/:id/:action', asyncHandler(async (req, res) => {
    const id = uuidParam(req);
    if (req.params.action === 'renew') return res.json(await subs.renewSubscription(id, req.user!));
    const to = PORTAL_ACTIONS[req.params.action as keyof typeof PORTAL_ACTIONS];
    if (!to) throw notFound('Action');
    res.json(await subs.changeStatus(id, to, req.user!));
  }));
  portal.get('/invoices', asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    res.json({ ...(await invoices.listInvoices({ customerId: req.user!.id, hideDrafts: true, ...page })), page: page.page, pageSize: page.pageSize });
  }));
  portal.get('/invoices/:id', asyncHandler(async (req, res) => { res.json(await invoices.getInvoice(uuidParam(req), req.user!)); }));
  r.use('/portal', portal);
  return r;
}

/** Daily billing at 01:00 server time. Safe alongside manual runs because billing is idempotent. */
export function startBillingSchedule() {
  cron.schedule('0 1 * * *', () => {
    runBilling(todayStr()).then((s) => console.log('Billing run', s)).catch((e) => console.error('Billing run failed', e));
  });
}
