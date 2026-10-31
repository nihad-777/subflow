
# Subscriptions & Billing Module

Owner: Member 3

## 1. Database Tables

### subscriptions
Stores the main subscription information.

- id
- subscription_number
- customer_id
- plan_id
- quotation_id
- start_date
- end_date
- next_billing_date
- status
- created_at
- updated_at

### subscription_items
Stores the products included in a subscription.

- id
- subscription_id
- product_id
- product_variant_id
- quantity
- unit_price
- tax_rule_id
- created_at

### tax_rules
Stores applicable tax rules.

- id
- name
- tax_rate
- description
- is_active
- created_at

### invoices
Stores invoices generated for subscriptions.

- id
- invoice_number
- subscription_id
- customer_id
- invoice_date
- due_date
- billing_period_start
- billing_period_end
- subtotal
- tax_amount
- discount_amount
- total_amount
- status
- created_at

### invoice_items
Stores individual invoice line items.

- id
- invoice_id
- product_id
- description
- quantity
- unit_price
- tax_rate
- tax_amount
- line_total

## 2. Subscription Lifecycle

Draft → Quotation → Confirmed → Active → Closed

Additional operations:
- Pause subscription
- Resume subscription
- Renew subscription
- Early close subscription

The exact lifecycle rules will follow the plan configuration.

## 3. Invoice Lifecycle

Draft → Confirmed → Paid

Other possible operations:
- Cancel invoice
- Send invoice
- Print invoice

## 4. Main Backend Responsibilities

- Create subscriptions from confirmed quotations.
- Activate, pause, resume and close subscriptions.
- Manage subscription lifecycle.
- Identify subscriptions due for billing.
- Generate invoices automatically.
- Calculate applicable taxes.
- Support recurring billing.
- Prevent duplicate invoices for the same billing period.

## 5. Integration Dependencies

- Member 1: Authentication, profiles and user roles.
- Member 2: Products, product variants, plans and quotations.
- Member 4: Discounts, payments and analytics.

## 6. Important Database Constraints

- Subscription numbers must be unique.
- Invoice numbers must be unique.
- Prevent duplicate invoices for the same subscription and billing period.
- Use appropriate foreign keys for shared tables.
- Apply database-level access control using Supabase RLS.
