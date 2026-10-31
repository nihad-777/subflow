
-- ============================================
-- SUBFLOW: PRODUCT CATALOG DATABASE
-- Module: Products, Plans and Quotations
-- ============================================

-- 1. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. PRODUCT VARIANTS
CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL
        REFERENCES public.products(id) ON DELETE CASCADE,
    variant_name VARCHAR(150) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    attributes JSONB NOT NULL DEFAULT '{}'::JSONB,
    price NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. PLANS
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    billing_frequency VARCHAR(20) NOT NULL
        CHECK (
            billing_frequency IN ('daily', 'weekly', 'monthly', 'yearly')
        ),
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- 4. PLAN PRODUCTS
CREATE TABLE IF NOT EXISTS public.plan_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL
        REFERENCES public.plans(id) ON DELETE CASCADE,
    product_id UUID NOT NULL
        REFERENCES public.products(id) ON DELETE RESTRICT,
    product_variant_id UUID
        REFERENCES public.product_variants(id) ON DELETE RESTRICT,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1
        CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, product_id, product_variant_id)
);

-- 5. QUOTATION TEMPLATES
CREATE TABLE IF NOT EXISTS public.quotation_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    subject VARCHAR(255),
    content TEXT NOT NULL,
    terms_and_conditions TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_product_variants_product
    ON public.product_variants(product_id);

CREATE INDEX IF NOT EXISTS idx_plan_products_plan
    ON public.plan_products(plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_products_product
    ON public.plan_products(product_id);

CREATE INDEX IF NOT EXISTS idx_products_active
    ON public.products(is_active);

CREATE INDEX IF NOT EXISTS idx_plans_active
    ON public.plans(is_active);
