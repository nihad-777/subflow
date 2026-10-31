-- Subflow authentication and profile schema.
-- Run this migration once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'staff', 'customer');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- SECURITY DEFINER avoids recursive profiles RLS checks when policies inspect a role.
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.role is distinct from old.role
      or new.email is distinct from old.email
      or new.created_at is distinct from old.created_at)
     and current_user not in ('postgres', 'service_role')
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Protected profile fields can only be changed by a trusted administrator';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
drop trigger if exists profiles_prevent_self_role_change on public.profiles;
create trigger profiles_protect_fields before update on public.profiles
for each row execute function public.protect_profile_fields();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Auth metadata is user-controlled. Only full_name is copied; role always defaults to customer.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles" on public.profiles
for select to authenticated using (public.current_app_role() = 'admin');

drop policy if exists "Users can update own non-role profile fields" on public.profiles;
create policy "Users can update own non-role profile fields" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = public.current_app_role()
);

-- No client-side insert or delete policies are provided. Profile creation happens via
-- the auth trigger; role changes and account provisioning require a trusted admin path.
revoke insert, delete on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

-- One-time bootstrap after registering your own account. Replace the email.
-- update public.profiles set role = 'admin' where email = 'you@example.com';
