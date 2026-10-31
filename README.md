# Subflow

Authentication and role-based application foundation for the Subflow team project.

## Stack

- React + TypeScript + Vite frontend (`frontend/`)
- Node.js + Express API (`backend/`)
- Supabase Auth and Postgres

## Local setup

1. Create a Supabase project and run `database/schema.sql` in its SQL Editor.
2. Copy `frontend/.env.example` to `frontend/.env` and set the project URL and anon key.
3. Copy `backend/.env.example` to `backend/.env`. Set the project URL, anon key, and service role key there. Keep the service role key private and server-side.
4. Bootstrap your first administrator by registering the admin account, then uncomment the one-time example at the bottom of `database/schema.sql` and replace the email. Only do this for the trusted project owner account.
5. Install and run the frontend from `frontend/` with `npm install` then `npm run dev`.
6. Install and run the API from `backend/` with `npm install` then `npm run dev`.

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

## Product & Plans client

The product catalog screens are in `client/` and the catalog API is in `server/`. To run this part of the project:

1. Run `database/product_catalog.sql` in the same Supabase project after `database/schema.sql`.
2. Copy `client/.env.example` to `client/.env` and set the Supabase URL, publishable key, and API URL.
3. Copy `server/.env.example` to `server/.env` and set the same Supabase URL and publishable key plus the secret key. Keep the secret key server-side.
4. Start the API from `server/` with `npm install` then `npm start`.
5. Start the product client from `client/` with `npm install` then `npm run dev`.
6. Sign in with an administrator account. Catalog endpoints are restricted to admins.

Products, variants, plans, plan product links, and quotation templates are persisted in Supabase. Product variant prices are calculated as the product base price plus the variant price adjustment.
