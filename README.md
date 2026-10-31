# Subflow

Authentication and role-based application foundation for the Subflow team project.

## Stack

- React + TypeScript + Vite frontend (`frontend/`)
- Node.js + Express API (`backend/`)
- Supabase Auth and Postgres

## Local setup

1. Create a Supabase project and run `database/schema.sql` in its SQL Editor.
2. After the subscriptions and invoices tables from Member 3 are installed, run `database/payments_analytics.sql` in the SQL Editor (Payments & Analytics: discounts, payments, indexes).
3. Copy `frontend/.env.example` to `frontend/.env` and set the project URL and anon key.
4. Copy `backend/.env.example` to `backend/.env`. Set the project URL, anon key, and service role key there, plus `DATABASE_URL` (Supabase > Connect > Session pooler) for Payments & Analytics. Keep the service role key private and server-side.
5. Bootstrap your first administrator by registering the admin account, then uncomment the one-time example at the bottom of `database/schema.sql` and replace the email. Only do this for the trusted project owner account.
6. Install and run the frontend from `frontend/` with `npm install` then `npm run dev`.
7. Install and run the API from `backend/` with `npm install` then `npm run dev`.

Set the Supabase Auth site URL to `http://localhost:5173` during local development. Add `http://localhost:5173/update-password` to the allowed redirect URLs so password reset links return to the app.

## Roles

- `admin`: staff creation and application administration
- `staff`: internal workspace
- `customer`: customer workspace; default for self-service registration

Do not expose the Supabase service role key in the frontend.

## Included features

- Email and password registration and login
- Password reset email and password update flow
- Customer default role on registration; profile roles protected from client changes
- Admin, staff, and customer workspaces with shared sidebar and top navigation
- Admin member list and staff invitation endpoint (`POST /api/admin/staff`)
- Profile name management

Express endpoints require a valid Supabase access token. The staff invitation endpoint checks the caller's admin role and uses the service role key only on the server.

## Payments & Analytics (Member 4)

Code: `backend/src/payments/`, `frontend/src/finance/`, `database/payments_analytics.sql`. The API is mounted at `/api/finance`; the UI is the "Finance & reports" page.

- Discounts: admin create/edit/deactivate; FIXED or PERCENT; applies to products or a whole subscription; date window, minimum purchase or quantity, usage limit. Usage limits are race-safe.
- Payments: record against an invoice (CASH, BANK_TRANSFER, CARD, UPI, CHEQUE, OTHER). Partial payments are allowed, overpayment is refused, and an `idempotencyKey` on the request makes retries safe. Admins can void a payment.
- Overdue invoices: Confirmed, past due date, balance above zero, in 1-30 / 31-60 / 61-90 / 90+ day buckets.
- Revenue dashboard: MRR, invoiced vs collected, by plan and method, outstanding aging, top outstanding customers.
- Roles are enforced on the server from `profiles.role` (admin and staff manage finance; customers see only their own payments).

Run order: `database/schema.sql`, Member 3's tables, then `database/payments_analytics.sql`. Money is `numeric(12,2)` in Postgres.

Billing integration: call `applyDiscounts` and `recordDiscountUsage` (exported from `backend/src/payments/index.ts`) inside the invoice-creation transaction.

Local testing (needs a local Postgres, not Supabase): set `TEST_DATABASE_URL`, then `cd backend && npm test`. `npm run payments:db` builds a local database with stub Member 3 tables in `database/dev/`; those stubs are for local use only and must never be run on Supabase. `npm run payments:seed` loads demo data.
