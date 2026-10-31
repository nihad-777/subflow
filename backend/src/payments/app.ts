import express from 'express';
import cors from 'cors';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './lib/http.js';
import { discountRouter } from './modules/discounts/discount.routes.js';
import { paymentRouter, meRouter } from './modules/payments/payment.routes.js';
import { invoicePaymentsRouter } from './modules/payments/invoice-balance.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { lookupsRouter } from './modules/lookups.routes.js';
import { billingRouter } from '../billing/index.js';

// Response time header: the dashboard shows it to prove the < 2 s target.
function responseTime(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = process.hrtime.bigint();
  const end = res.end.bind(res);
  res.end = ((...args: Parameters<typeof res.end>) => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (!res.headersSent) res.setHeader('X-Response-Time', `${ms.toFixed(0)}ms`);
    return end(...args);
  }) as typeof res.end;
  next();
}

/**
 * Everything this module serves, as one router. server.js mounts it with
 *   app.use('/api/finance', paymentsAnalyticsRouter())
 * It verifies the Supabase access token itself and reads the role from profiles.
 */
export function paymentsAnalyticsRouter() {
  const r = express.Router();
  r.use(responseTime);
  r.use(authenticate);
  r.use('/discounts', discountRouter);
  r.use('/payments', paymentRouter);
  r.use('/invoices', invoicePaymentsRouter);
  r.use('/reports', reportsRouter);
  r.use('/me', meRouter);
  r.use('/lookups', lookupsRouter);
  r.use(billingRouter());
  // Own error handler: server.js's global one would turn HttpErrors into 500s.
  r.use(errorHandler);
  return r;
}

/** Standalone app for tests: same mount point as server.js. */
export function createApp() {
  const app = express();
  app.use(cors({ exposedHeaders: ['X-Response-Time'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/finance', paymentsAnalyticsRouter());
  app.use(errorHandler);
  return app;
}
