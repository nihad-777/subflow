// Mounted at /api/invoices alongside the invoice owner's own router.
// Only adds read-only, payment-related views of invoices.
import { Router } from 'express';
import { asyncHandler, pagination, uuidParam } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { getBalanceFor, payableInvoices } from './payment.service.js';
import { overdueInvoices } from '../reports/reports.service.js';

export const invoicePaymentsRouter = Router();

invoicePaymentsRouter.get('/overdue', requireRole('ADMIN', 'STAFF'), asyncHandler(async (req, res) => {
  const page = pagination(req.query);
  const q = req.query as Record<string, string | undefined>;
  const result = await overdueInvoices({
    bucket: q.bucket,
    customerId: q.customerId,
    minAmount: q.minAmount ? Number(q.minAmount) : undefined,
    ...page,
  });
  res.json({ ...result, page: page.page, pageSize: page.pageSize });
}));

invoicePaymentsRouter.get('/payable', requireRole('ADMIN', 'STAFF'), asyncHandler(async (req, res) => {
  res.json(await payableInvoices(typeof req.query.q === 'string' ? req.query.q : undefined));
}));

invoicePaymentsRouter.get('/:id/balance', requireRole('ADMIN', 'STAFF', 'CUSTOMER'), asyncHandler(async (req, res) => {
  res.json(await getBalanceFor(req.user!, uuidParam(req)));
}));
