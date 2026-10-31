-- DEV/TEST ONLY: makes a plain local Postgres look enough like Supabase for
-- schema.sql to run (auth schema, auth.users, auth.uid(), the API roles).
-- Never run this on a real Supabase project (it already has all of this).
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
