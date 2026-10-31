import { Router } from 'express';
import { asyncHandler, idParam, pagination } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import * as svc from './payment.service.js';
import { queryOne } from '../../lib/db.js';

export const paymentRouter = Router();

paymentRouter.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    const q = req.query as Record<string, string | undefined>;
    const result = await svc.listPayments(
      { from: q.from, to: q.to, method: q.method, customerId: q.customerId, invoiceId: q.invoiceId && /^[0-9a-f-]{36}$/i.test(q.invoiceId) ? q.invoiceId : undefined, status: q.status, q: q.q },
      page,
    );
    res.json({ ...result, page: page.page, pageSize: page.pageSize });
  }),
);

paymentRouter.get(
  '/:id',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getPayment(idParam(req)));
  }),
);

paymentRouter.post(
  '/',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    const result = await svc.recordPayment(req.body, req.user!);
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);

paymentRouter.post(
  '/:id/void',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await svc.voidPayment(idParam(req), req.body, req.user!));
  }),
);

// Who am I (any role). The frontend uses it to show/hide admin-only actions;
// the server still enforces every rule.
export const meRouter = Router();

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = await queryOne('SELECT id, full_name AS name, email, upper(role::text) AS role FROM profiles WHERE id = $1', [req.user!.id]);
    res.json(me);
  }),
);

// Customer portal: own payment history.
meRouter.get(
  '/payments',
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    const result = await svc.listPayments({ customerId: req.user!.id }, page);
    res.json({ ...result, page: page.page, pageSize: page.pageSize });
  }),
);
