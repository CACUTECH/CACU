-- CACU-fresh schema reconciliation
--
-- IMPORTANT: this project's Supabase database is NOT a blank slate. It
-- already has a comprehensive, well-designed multi-tenant schema (24
-- tables: businesses, catalog_items, customers, employees, invoices,
-- invoice_items, jobs, memberships, notifications, payments, transactions,
-- transaction_items, plus a richer accounting/payroll/notifications system
-- — accounts, journal_entries, journal_lines, payroll_runs, payslips,
-- notification_logs, notification_preferences, payment_events,
-- payment_status_history, storefront_settings, user_devices, appointments —
-- belonging to a different, more mature version of this app), complete with
-- a granular RLS/role model: a `membership_role` enum (owner/admin/editor/
-- viewer) and `is_business_member(business_id)` /
-- `has_business_role(business_id, role[])` helper functions.
--
-- This migration does NOT rename or restructure any of that — the
-- CACU-fresh application code was adapted to match the existing schema
-- instead (see src/services/*.ts). This file only:
--   1. Adds tables CACU-fresh's code needs that have no existing
--      equivalent: profiles, suppliers, financial_transactions,
--      attendance, audit_logs.
--   2. Adds a small number of columns to existing tables where a genuine
--      feature has no existing home (e.g. catalog_items.description).
--   3. Adds the RPC functions and views CACU-fresh's services call,
--      written against the REAL existing column names, reusing
--      is_business_member()/has_business_role() rather than inventing a
--      parallel authorization scheme.
--
-- Tables intentionally left completely untouched: accounts, appointments,
-- businesses, catalog_items (existing columns), customers (existing
-- columns), employees (existing columns), invoice_items, invoices
-- (existing columns), journal_entries, journal_lines, memberships,
-- notification_logs, notification_preferences, payment_events,
-- payment_status_history, payments (existing columns), payroll_runs,
-- payslips, storefront_settings, transaction_items, transactions,
-- user_devices.
--
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. NEW TABLES (no existing equivalent)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_biz_name ON suppliers(business_id, name);

-- General-purpose income/expense ledger. Distinct from `transactions`
-- (which is POS/sale-shaped: customer_id, payment_method, line items) —
-- this backs manual journal entries, invoice payments, and the KPI/P&L
-- reporting functions below.
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount <> 0),
  type TEXT NOT NULL, -- Income, Expense
  category TEXT,
  date DATE DEFAULT CURRENT_DATE,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  reference_type TEXT, -- Sale, Invoice, Expense
  reference_id UUID
);

CREATE INDEX IF NOT EXISTS idx_tx_biz_date_type ON financial_transactions(business_id, date DESC, type);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status TEXT DEFAULT 'Present',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_biz_date ON attendance(business_id, check_in DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID,
  user_id UUID,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_biz_date ON audit_logs(business_id, created_at DESC);

-- ============================================================
-- 2. NEW COLUMNS on existing tables (genuine feature gaps only —
-- everything else already has a same-purpose column under a different
-- name, and the application code was adapted to use those instead)
-- ============================================================
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 0; -- minutes, for services

ALTER TABLE customers ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_spend NUMERIC(15,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier TEXT DEFAULT 'Standard';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT now();

ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'Invoice'; -- Invoice, CreditMemo
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax NUMERIC(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_included BOOLEAN DEFAULT false;

-- payment-service.ts's record_payment_atomic needs to attribute a payment
-- to a customer; the existing table only tracks customer_email.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ============================================================
-- 3. RPC FUNCTIONS — written against the REAL column names, reusing the
-- existing is_business_member()/has_business_role() helpers.
-- ============================================================

-- Atomic POS checkout: stock validation + transaction header + line items
-- + a ledger entry, targeting the existing transactions/transaction_items
-- tables (there is no separate sales/sale_items pair — `transactions` IS
-- the sales record in this schema).
CREATE OR REPLACE FUNCTION process_sale(
  p_business_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_payment_method TEXT,
  p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
  v_transaction_id UUID;
  v_item JSONB;
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM catalog_items
      WHERE id = (v_item->>'id')::UUID
      AND stock_quantity >= (v_item->>'quantity')::INTEGER
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_item->>'name';
    END IF;
  END LOOP;

  INSERT INTO transactions (business_id, customer_id, created_by, status, payment_method, subtotal, total)
  VALUES (p_business_id, p_customer_id, auth.uid(), 'Completed', p_payment_method, p_total_amount, p_total_amount)
  RETURNING id INTO v_transaction_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO transaction_items (business_id, transaction_id, catalog_item_id, description, quantity, unit_price, line_total)
    VALUES (
      p_business_id,
      v_transaction_id,
      (v_item->>'id')::UUID,
      v_item->>'name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'price')::NUMERIC,
      ((v_item->>'quantity')::NUMERIC * (v_item->>'price')::NUMERIC)
    );

    UPDATE catalog_items
    SET stock_quantity = stock_quantity - (v_item->>'quantity')::INTEGER
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_type, reference_id)
  VALUES (p_business_id, 'POS Sale: ' || v_transaction_id, p_total_amount, 'Income', 'Sales', 'Sale', v_transaction_id);

  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_business_kpis(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  total_income NUMERIC,
  total_expense NUMERIC,
  net_profit NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0),
    COUNT(*)
  FROM financial_transactions
  WHERE business_id = p_business_id
  AND date BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_revenue_trend(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_interval TEXT DEFAULT 'month'
) RETURNS TABLE (
  period TEXT,
  income NUMERIC,
  expense NUMERIC
) AS $$
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(
      DATE_TRUNC(
        CASE p_interval WHEN 'day' THEN 'day' WHEN 'week' THEN 'week' ELSE 'month' END,
        financial_transactions.date
      ),
      'YYYY-MM-DD'
    ) AS period,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) AS income,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) AS expense
  FROM financial_transactions
  WHERE business_id = p_business_id
    AND date BETWEEN p_start_date AND p_end_date
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION record_audit(
  p_business_id UUID,
  p_action TEXT,
  p_table TEXT,
  p_record_id UUID,
  p_details JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, auth.uid(), p_action, p_table, p_record_id, p_details)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic, race-condition-safe stock delta against catalog_items.stock_quantity.
CREATE OR REPLACE FUNCTION adjust_inventory_stock(
  p_item_id UUID,
  p_business_id UUID,
  p_delta INTEGER
) RETURNS VOID AS $$
DECLARE
  v_current INTEGER;
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  SELECT stock_quantity INTO v_current
  FROM catalog_items
  WHERE id = p_item_id AND business_id = p_business_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_current + p_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock';
  END IF;

  UPDATE catalog_items
  SET stock_quantity = v_current + p_delta
  WHERE id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Invoice header + line items in one transaction, against the existing
-- invoices/invoice_items column names (issue_date, description, line_total).
CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_business_id UUID,
  p_customer_id UUID,
  p_invoice_number TEXT,
  p_type TEXT,
  p_status TEXT,
  p_date DATE,
  p_due_date DATE,
  p_subtotal NUMERIC,
  p_tax NUMERIC,
  p_total NUMERIC,
  p_vat_included BOOLEAN,
  p_notes TEXT,
  p_items JSONB
) RETURNS UUID AS $$
DECLARE
  v_invoice_id UUID;
  v_item JSONB;
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO invoices (
    business_id, customer_id, invoice_number, type, status,
    issue_date, due_date, subtotal, tax, total, vat_included, notes
  ) VALUES (
    p_business_id, p_customer_id, p_invoice_number, p_type, p_status,
    p_date, p_due_date, p_subtotal, p_tax, p_total, p_vat_included, p_notes
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO invoice_items (business_id, invoice_id, catalog_item_id, description, quantity, unit_price, line_total)
    VALUES (
      p_business_id,
      v_invoice_id,
      NULLIF(v_item->>'catalog_item_id', '')::UUID,
      v_item->>'item_name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'total_price')::NUMERIC
    );
  END LOOP;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Payment + invoice status update + ledger entry in one transaction.
-- Reuses the existing `channel` column for the app's "payment method"
-- concept rather than adding a duplicate column.
CREATE OR REPLACE FUNCTION record_payment_atomic(
  p_business_id UUID,
  p_invoice_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_reference TEXT
) RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO payments (
    business_id, invoice_id, customer_id, amount, currency, channel,
    reference, status, initialized_by, initialized_at, verified_at
  ) VALUES (
    p_business_id, p_invoice_id, p_customer_id, p_amount, 'NGN', p_payment_method,
    p_reference, 'success', auth.uid(), now(), now()
  ) RETURNING id INTO v_payment_id;

  UPDATE invoices SET status = 'Paid', updated_at = now()
  WHERE id = p_invoice_id AND business_id = p_business_id;

  INSERT INTO financial_transactions (business_id, description, amount, type, category, created_by, reference_type, reference_id)
  VALUES (p_business_id, 'Invoice Payment Received', p_amount, 'Income', 'Sales', auth.uid(), 'Invoice', p_invoice_id);

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. VIEWS — output column names are CACU-fresh's own design; the
-- underlying SELECT uses the real catalog_items/transactions column names.
-- `security_invoker = true` (PG15+) is required so the view enforces the
-- querying user's RLS rather than the view owner's.
-- ============================================================
CREATE OR REPLACE VIEW view_inventory_valuation
WITH (security_invoker = true) AS
SELECT
  business_id,
  COUNT(*) FILTER (WHERE item_type = 'PRODUCT') AS total_skus,
  COALESCE(SUM(unit_price * stock_quantity) FILTER (WHERE item_type = 'PRODUCT'), 0) AS total_asset_value,
  COUNT(*) FILTER (WHERE item_type = 'PRODUCT' AND stock_quantity <= reorder_level) AS low_stock_count
FROM catalog_items
GROUP BY business_id;

CREATE OR REPLACE VIEW view_product_performance
WITH (security_invoker = true) AS
SELECT
  t.business_id,
  ti.catalog_item_id,
  ti.description AS name,
  SUM(ti.quantity) AS units_sold,
  SUM(ti.line_total) AS revenue
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
GROUP BY t.business_id, ti.catalog_item_id, ti.description;

-- ============================================================
-- 5. ROW-LEVEL SECURITY — only for the 5 new tables. Every other table's
-- RLS was already correctly configured before this migration and is left
-- untouched.
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM memberships m1
    JOIN memberships m2 ON m1.business_id = m2.business_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
  )
);
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppliers_select ON suppliers;
CREATE POLICY suppliers_select ON suppliers FOR SELECT USING (is_business_member(business_id));
DROP POLICY IF EXISTS suppliers_insert ON suppliers;
CREATE POLICY suppliers_insert ON suppliers FOR INSERT WITH CHECK (is_business_member(business_id));
DROP POLICY IF EXISTS suppliers_update ON suppliers;
CREATE POLICY suppliers_update ON suppliers FOR UPDATE USING (has_business_role(business_id, ARRAY['owner','admin','editor']::membership_role[])) WITH CHECK (has_business_role(business_id, ARRAY['owner','admin','editor']::membership_role[]));
DROP POLICY IF EXISTS suppliers_delete ON suppliers;
CREATE POLICY suppliers_delete ON suppliers FOR DELETE USING (has_business_role(business_id, ARRAY['owner','admin']::membership_role[]));

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_transactions_select ON financial_transactions;
CREATE POLICY financial_transactions_select ON financial_transactions FOR SELECT USING (is_business_member(business_id));
DROP POLICY IF EXISTS financial_transactions_insert ON financial_transactions;
CREATE POLICY financial_transactions_insert ON financial_transactions FOR INSERT WITH CHECK (is_business_member(business_id));
DROP POLICY IF EXISTS financial_transactions_update ON financial_transactions;
CREATE POLICY financial_transactions_update ON financial_transactions FOR UPDATE USING (has_business_role(business_id, ARRAY['owner','admin']::membership_role[])) WITH CHECK (has_business_role(business_id, ARRAY['owner','admin']::membership_role[]));
DROP POLICY IF EXISTS financial_transactions_delete ON financial_transactions;
CREATE POLICY financial_transactions_delete ON financial_transactions FOR DELETE USING (has_business_role(business_id, ARRAY['owner','admin']::membership_role[]));

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_select ON attendance;
CREATE POLICY attendance_select ON attendance FOR SELECT USING (is_business_member(business_id));
DROP POLICY IF EXISTS attendance_insert ON attendance;
CREATE POLICY attendance_insert ON attendance FOR INSERT WITH CHECK (is_business_member(business_id));
DROP POLICY IF EXISTS attendance_update ON attendance;
CREATE POLICY attendance_update ON attendance FOR UPDATE USING (is_business_member(business_id)) WITH CHECK (is_business_member(business_id));
DROP POLICY IF EXISTS attendance_delete ON attendance;
CREATE POLICY attendance_delete ON attendance FOR DELETE USING (has_business_role(business_id, ARRAY['owner','admin']::membership_role[]));

-- audit_logs: written only via record_audit() (SECURITY DEFINER); no
-- UPDATE/DELETE policy is added, so RLS denies both by default —
-- immutable from the client.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (is_business_member(business_id));

-- notifications already has RLS enabled with SELECT/UPDATE-own-row
-- policies, but no INSERT policy — meaning notification-service.ts's
-- trigger() (which writes rows on behalf of OTHER business members, e.g.
-- notifying every Admin about a low-stock event) would be silently
-- rejected. Members can create notifications for other members of their
-- own business only.
DROP POLICY IF EXISTS notifications_insert_business_member ON notifications;
CREATE POLICY notifications_insert_business_member ON notifications FOR INSERT WITH CHECK (is_business_member(business_id));

-- ============================================================
-- 6. STORAGE — private "business-assets" bucket, path-scoped by
-- {businessId}/... (matches storage-service.ts's convention)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-assets', 'business-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "business_assets_select" ON storage.objects;
CREATE POLICY "business_assets_select" ON storage.objects FOR SELECT USING (
  bucket_id = 'business-assets'
  AND is_business_member((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "business_assets_insert" ON storage.objects;
CREATE POLICY "business_assets_insert" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'business-assets'
  AND is_business_member((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "business_assets_delete" ON storage.objects;
CREATE POLICY "business_assets_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'business-assets'
  AND is_business_member((storage.foldername(name))[1]::uuid)
);
