// Small read-only lists for pickers and filters. These read teammates' tables;
// if they already expose equivalent endpoints, point the frontend at those instead.
import { Router } from 'express';
import { query } from '../lib/db.js';
import { asyncHandler } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';

export const lookupsRouter = Router();
lookupsRouter.use(requireRole('ADMIN', 'STAFF'));

const like = (q: unknown) => (typeof q === 'string' && q ? `%${q}%` : '%');

lookupsRouter.get('/products', asyncHandler(async (req, res) => {
  res.json(await query('SELECT id, name, price::float AS price FROM products WHERE name ILIKE $1 ORDER BY name LIMIT 50', [like(req.query.q)]));
}));

lookupsRouter.get('/plans', asyncHandler(async (_req, res) => {
  res.json(await query('SELECT id, name, frequency AS "billingPeriod" FROM plans ORDER BY name'));
}));

lookupsRouter.get('/customers', asyncHandler(async (req, res) => {
  res.json(await query(
    `SELECT id, full_name AS name, email FROM profiles WHERE role = 'customer' AND (full_name ILIKE $1 OR email ILIKE $1) ORDER BY full_name LIMIT 50`,
    [like(req.query.q)],
  ));
}));

lookupsRouter.get('/subscriptions', asyncHandler(async (req, res) => {
  res.json(await query(
    `SELECT s.id, s.subscription_number AS number, s.status, p.full_name AS "customerName", pl.name AS "planName"
       FROM subscriptions s JOIN profiles p ON p.id = s.customer_id JOIN plans pl ON pl.id = s.plan_id
      WHERE s.subscription_number ILIKE $1 OR p.full_name ILIKE $1
      ORDER BY s.id DESC LIMIT 50`,
    [like(req.query.q)],
  ));
}));
