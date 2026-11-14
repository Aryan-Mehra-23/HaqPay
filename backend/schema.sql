-- HaqPay MVP relational model (PostgreSQL)
-- Money is stored as integer paise. All timestamps are timezone-aware.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    business_name text NOT NULL,
    phone text NOT NULL UNIQUE,
    email text,
    language text NOT NULL DEFAULT 'en',
    udyam_number text,
    udyam_status text NOT NULL DEFAULT 'self_declared' CHECK (udyam_status IN ('not_provided','self_declared','verified')),
    plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    name text NOT NULL,
    business_name text,
    phone text,
    whatsapp text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, id)
);
CREATE INDEX customers_supplier_idx ON customers(supplier_id);

CREATE TABLE invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    invoice_number text NOT NULL,
    amount_paise bigint NOT NULL CHECK (amount_paise > 0),
    invoice_date date NOT NULL,
    agreed_credit_days integer NOT NULL DEFAULT 15 CHECK (agreed_credit_days >= 0),
    due_date date NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','disputed','partly_paid','paid','overdue')),
    source text NOT NULL DEFAULT 'manual' CHECK (source IN ('photo','manual')),
    original_photo_key text,
    ai_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    confirmed_by_user boolean NOT NULL DEFAULT false,
    dispute_paused boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (supplier_id, customer_id) REFERENCES customers(supplier_id, id),
    UNIQUE (supplier_id, customer_id, invoice_number)
);
CREATE INDEX invoices_supplier_status_due_idx ON invoices(supplier_id, status, due_date);

CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_paise bigint NOT NULL CHECK (amount_paise > 0),
    paid_at timestamptz NOT NULL,
    mode text NOT NULL CHECK (mode IN ('upi','bank','cash')),
    marked_by text NOT NULL CHECK (marked_by IN ('supplier','buyer','webhook')),
    provider_reference text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_date_idx ON payments(invoice_id, paid_at);

CREATE TABLE buyer_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    opened_at timestamptz,
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (reason IN ('goods_damaged','wrong_quantity','already_paid','other')),
    buyer_comment text,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    resolution_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE TABLE message_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('friendly','legal')),
    message_text text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email','pdf')),
    sent_at timestamptz,
    delivery_status text NOT NULL DEFAULT 'queued',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_profiles (
    supplier_id uuid PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
    cash_in_hand_paise bigint NOT NULL DEFAULT 0 CHECK (cash_in_hand_paise >= 0),
    weekly_costs_paise bigint NOT NULL DEFAULT 0 CHECK (weekly_costs_paise >= 0),
    weekly_sales_paise bigint NOT NULL DEFAULT 0 CHECK (weekly_sales_paise >= 0),
    average_credit_days integer NOT NULL DEFAULT 30 CHECK (average_credit_days BETWEEN 0 AND 365),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    plan text NOT NULL CHECK (plan IN ('free','pro','business')),
    price_paise integer NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','cancelled','trialing')),
    renewal_at timestamptz,
    provider_reference text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    actor_type text NOT NULL CHECK (actor_type IN ('supplier','buyer','admin','system')),
    actor_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_supplier_time_idx ON audit_logs(supplier_id, created_at DESC);

CREATE TABLE app_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_config(key, value) VALUES
    ('rbi_bank_rate_percent', '5.75'::jsonb),
    ('interest_rate_multiplier', '3'::jsonb),
    ('interest_month_days', '30.4'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Interest and remaining principal are derived from the invoice plus its
-- dated payments; do not persist a second, potentially stale interest total.
-- The API must scope every invoice/customer/payment query by authenticated supplier_id.
