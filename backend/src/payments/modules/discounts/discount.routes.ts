import { Router } from 'express';
import { asyncHandler, idParam, pagination } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import * as svc from './discount.service.js';

export const discountRouter = Router();

// Staff can see discounts (read-only); only admins can change them.
discountRouter.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    const page = pagination(req.query);
    const q = req.query as Record<string, string | undefined>;
    const result = await svc.listDiscounts({ status: q.status, scope: q.scope, q: q.q, ...page });
    res.json({ ...result, page: page.page, pageSize: page.pageSize });
  }),
);

discountRouter.post(
  '/preview',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    res.json(await svc.previewDiscounts(req.body));
  }),
);

discountRouter.get(
  '/:id',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getDiscount(idParam(req)));
  }),
);

discountRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.createDiscount(req.body, req.user!.id));
  }),
);

discountRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await svc.updateDiscount(idParam(req), req.body));
  }),
);

discountRouter.post(
  '/:id/deactivate',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await svc.setDiscountActive(idParam(req), false));
  }),
);

discountRouter.post(
  '/:id/activate',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await svc.setDiscountActive(idParam(req), true));
  }),
);

discountRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await svc.deleteDiscount(idParam(req));
    res.status(204).end();
  }),
);
