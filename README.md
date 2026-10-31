# Subflow

Subflow team application with authentication, role-based workspaces, and product management.

## Stack

- React + Vite frontend (`client/`)
- Node.js + Express API (`backend/`)
- Supabase Auth and Postgres

## Local setup

1. Coordinate Supabase project setup and run `database/schema.sql` in its SQL Editor.
2. Copy `client/.env.example` to `client/.env` and set the project URL and publishable key.
3. Copy `backend/.env.example` to `backend/.env`. Set the project URL, anon key, and service role key there. Keep the service role key private and server-side.
4. Register the first trusted account, then set its role to `admin` in the SQL Editor with `update public.profiles set role = 'admin' where email = 'you@example.com';`.
5. Install and run the frontend from `client/` with `npm install` then `npm run dev`.
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
