# SubFlow

Subflow is a subscription management application designed to simplify
the management of products, plans, quotations, subscriptions, invoices,
payments and customer interactions.

The application provides role-based workspaces for administrators,
staff members and customers, bringing subscription and billing
operations together in one platform.

## Stack

- React + Vite frontend (`client/`)
- Node.js + Express API (`backend/`)
- Supabase Auth and Postgres

## Prerequisites

Make sure you have the following installed:

- Node.js (LTS version)
- npm
- Git
- A Supabase account and project
- PostgreSQL (for running backend tests locally)

## Local setup

1. Coordinate Supabase project setup and run these files in its SQL Editor, in this order:
   - `database/schema.sql`
   - `database/product_catalog.sql`
   - `database/subscriptions_billing.sql`
   - `database/billing_integration.sql`
   - `database/payments_analytics.sql`
2. Copy `client/.env.example` to `client/.env` and set the project URL and publishable key.
3. Copy `backend/.env.example` to `backend/.env`. Set the project URL, anon key, service role key and `DATABASE_URL` (Supabase > Connect > Session pooler) there. Keep these private and server-side.
4. Register the first trusted account, then set its role to `admin` in the SQL Editor with `update public.profiles set role = 'admin' where email = 'you@example.com';`.
5. Install and run the frontend from `client/` with `npm install` then `npm run dev`.
6. Install and run the API from `backend/` with `npm install` then `npm run dev`.

In Supabase > Authentication > Sign In / Providers, set the password policy to a minimum of 9 characters with lowercase, uppercase and symbols, so the rule is enforced on the server as well as in the forms.

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
- Products with variants, recurring plans, quotation templates and tax rules
- Subscriptions from Draft to Closed, with a history of every change
- Billing run that creates invoices with tax and discounts and never bills a period twice, daily at 01:00 or from the Invoices page
- Invoice confirm, cancel, send by email (needs `SMTP_URL`) and PDF download
- Discounts, payments, overdue tracking and the revenue dashboard
- Customer portal: view subscriptions and invoices, accept quotes, pause, close, renew, download PDFs

## Tests and demo data

`npm test` in `backend/` needs a local Postgres at `postgresql://subflow:subflow@localhost:5432/subflow_test`. `npm run payments:seed:large` fills a local database with about 5,000 subscriptions.

Express endpoints require a valid Supabase access token. The staff invitation endpoint checks the caller's admin role and uses the service role key only on the server.
