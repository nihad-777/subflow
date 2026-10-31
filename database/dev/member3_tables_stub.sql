-- DEV ONLY. Minimal stand-ins for Member 2's products/plans and Member 3's
-- subscriptions/invoices, using the column names from subscriptions_billing.md.
-- Lets the payments & analytics module run before the real tables land.
-- Do NOT run this on the shared Supabase project once the real tables exist.

create table if not exists public.products (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  price  numeric(12,2) not null default 0
);

create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  price           numeric(12,2) not null default 0,
  billing_period  text not null check (billing_period in ('Daily','Weekly','Monthly','Yearly'))
);

create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  subscription_number  text not null unique,
  customer_id          uuid not null references public.profiles(id),
  plan_id              uuid not null references public.plans(id),
  status               text not null check (status in ('Draft','Quotation','Confirmed','Active','Closed')),
  start_date           date not null,
  end_date             date,
  created_at           timestamptz not null default now()
);

create table if not exists public.subscription_items (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.subscriptions(id) on delete cascade,
  product_id       uuid not null references public.products(id),
  quantity         int not null check (quantity > 0),
  unit_price       numeric(12,2) not null,
  created_at       timestamptz not null default now()
);

create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_number   text not null unique,
  subscription_id  uuid references public.subscriptions(id),
  customer_id      uuid not null references public.profiles(id),
  invoice_date     date not null,
  due_date         date not null,
  subtotal         numeric(12,2) not null,
  tax_amount       numeric(12,2) not null default 0,
  discount_amount  numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null,
  status           text not null check (status in ('Draft','Confirmed','Paid','Cancelled')),
  created_at       timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  product_id  uuid references public.products(id),
  description text,
  quantity    int not null,
  unit_price  numeric(12,2) not null,
  tax_rate    numeric(5,2) not null default 0,
  tax_amount  numeric(12,2) not null default 0,
  line_total  numeric(12,2) not null
);
