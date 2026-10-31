-- Product catalog tables for the Product & Plans client.
-- Run this after schema.sql in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'Software',
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price_adjustment numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  min_quantity integer not null default 1 check (min_quantity >= 1),
  starts_at date,
  ends_at date,
  auto_close boolean not null default false,
  allow_pause boolean not null default true,
  allow_early_close boolean not null default true,
  allow_renew boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists public.plan_products (
  plan_id uuid not null references public.plans(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  primary key (plan_id, product_id)
);

create table if not exists public.quotation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  validity_days integer not null default 30 check (validity_days > 0),
  line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_variants_product_idx on public.product_variants(product_id);
create index if not exists plan_products_product_idx on public.plan_products(product_id);

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.plans enable row level security;
alter table public.plan_products enable row level security;
alter table public.quotation_templates enable row level security;

do $$ declare t text; begin
  foreach t in array array['products','product_variants','plans','plan_products','quotation_templates'] loop
    execute format('drop policy if exists %I on public.%I', 'Admins manage ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (public.current_app_role() = ''admin'') with check (public.current_app_role() = ''admin'')', 'Admins manage ' || t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
