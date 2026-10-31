// Payments & Analytics (Member 4). Public surface: import from here, not internal files.
export { paymentsAnalyticsRouter, createApp } from './app.js';

// Billing teammate: call inside the invoice-creation transaction.
export {
  applyDiscounts,
  recordDiscountUsage,
  releaseDiscountUsage,
  DiscountLimitReachedError,
} from './modules/discounts/discount.service.js';
export { calculateDiscounts } from './modules/discounts/discount.engine.js';

// Invoice / portal teammates.
export { invoiceBalance } from './modules/payments/payment.service.js';
export { authenticate, requireRole, type AuthUser, type Role } from './middleware/auth.js';
