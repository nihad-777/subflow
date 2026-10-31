
-- ============================================
-- SUBSCRIPTIONS & BILLING MODULE
-- Owner: Member 3
-- ============================================

-- 1. Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_number VARCHAR(50) NOT NULL UNIQUE,

    customer_id UUID NOT NULL,
    plan_id UUID NOT NULL,
    quotation_id UUID,

    -- Preserve original plan terms
    billing_frequency VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    next_billing_date DATE,

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'quotation', 'confirmed',
            'active', 'paused', 'closed'
        )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (end_date IS NULL OR end_date >= start_date),
    CHECK (billing_frequency IN (
        'daily', 'weekly', 'monthly', 'yearly'
    ))
);

-- 2. Create tax_rules table
CREATE TABLE IF NOT EXISTS public.tax_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    tax_rate NUMERIC(7,4) NOT NULL CHECK (tax_rate >= 0),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create subscription_items table
CREATE TABLE IF NOT EXISTS public.subscription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE CASCADE,

    product_id UUID NOT NULL,
    product_variant_id UUID,

    description TEXT,
    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),

    tax_rule_id UUID
        REFERENCES public.tax_rules(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) NOT NULL UNIQUE,

    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,

    customer_id UUID NOT NULL,

    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,

    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,

    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'confirmed', 'paid', 'cancelled'
        )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (billing_period_end >= billing_period_start),

    -- Prevent duplicate invoices for the same billing period
    CONSTRAINT unique_subscription_billing_period
        UNIQUE (
            subscription_id,
            billing_period_start,
            billing_period_end
        )
);

-- 5. Create invoice_items table
CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_id UUID NOT NULL
        REFERENCES public.invoices(id) ON DELETE CASCADE,

    product_id UUID,
    description TEXT NOT NULL,

    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),

    -- Historical tax snapshot
    tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);

-- 6. Create indexes for commonly queried columns
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
    ON public.subscriptions(customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON public.subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing
    ON public.subscriptions(next_billing_date);

CREATE INDEX IF NOT EXISTS idx_subscription_items_subscription
    ON public.subscription_items(subscription_id);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
    ON public.invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_invoices_subscription
    ON public.invoices(subscription_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
    ON public.invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
    ON public.invoice_items(invoice_id);
