import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import * as svc from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(requireRole('ADMIN', 'STAFF'));

reportsRouter.get('/summary', asyncHandler(async (req, res) => {
  res.json(await svc.summary(svc.parseFilters(req.query)));
}));

reportsRouter.get('/revenue-trend', asyncHandler(async (req, res) => {
  res.json(await svc.revenueTrend(svc.parseFilters(req.query), String(req.query.granularity ?? 'month')));
}));

reportsRouter.get('/revenue-by-plan', asyncHandler(async (req, res) => {
  res.json(await svc.revenueByPlan(svc.parseFilters(req.query)));
}));

reportsRouter.get('/payments-by-method', asyncHandler(async (req, res) => {
  res.json(await svc.paymentsByMethod(svc.parseFilters(req.query)));
}));

reportsRouter.get('/aging', asyncHandler(async (req, res) => {
  const { planId, customerId } = svc.parseFilters(req.query);
  res.json(await svc.aging({ planId, customerId }));
}));

reportsRouter.get('/top-outstanding', asyncHandler(async (req, res) => {
  const { planId, customerId } = svc.parseFilters(req.query);
  res.json(await svc.topOutstanding({ planId, customerId }, Number(req.query.limit) || 10));
}));

/** One round trip for the whole dashboard. */
reportsRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const f = svc.parseFilters(req.query);
  const scope = { planId: f.planId, customerId: f.customerId };
  const [summary, trend, byPlan, byMethod, aging, topOutstanding] = await Promise.all([
    svc.summary(f),
    svc.revenueTrend(f, String(req.query.granularity ?? 'month')),
    svc.revenueByPlan(f),
    svc.paymentsByMethod(f),
    svc.aging(scope),
    svc.topOutstanding(scope, 5),
  ]);
  res.json({ summary, trend, byPlan, byMethod, aging, topOutstanding });
}));

