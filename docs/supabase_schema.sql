
-- CACU Production PostgreSQL Schema (Supabase)
-- Re-engineered for Multi-Tenancy, Financial Integrity, and Security.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS
CREATE TYPE business_model AS ENUM ('PRODUCT', 'SERVICE', 'HYBRID');
CREATE TYPE user_role AS ENUM ('Owner', 'Admin', 'Editor', 'Viewer');
CREATE TYPE tx_type AS ENUM ('Income', 'Expense');
CREATE TYPE invoice_status AS ENUM ('Draft', 'Pending', 'Unpaid', 'Paid', 'Accepted', 'Refunded', 'Cancelled');

-- 3. CORE TABLES

-- PROFILES (Linked to Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BUSINESSES (The Tenant Root)
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_type business_model DEFAULT 'HYBRID',
  sector TEXT,
  address TEXT,
  logo_url TEXT,
  email TEXT,
  phone TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  subscription_level TEXT DEFAULT 'Starter',
  owner_uid UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BUSINESS MEMBERS (Role-Based Access)
CREATE TABLE business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  role user_role DEFAULT 'Viewer' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

-- 4. OPERATIONAL TABLES

-- CATALOG (Products & Services)
CREATE TABLE catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  type TEXT CHECK (type IN ('Product', 'Service', 'Package')) NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  description TEXT,
  price DECIMAL(15,2) NOT NULL DEFAULT 0,
  quantity INTEGER DEFAULT 0, -- Only for products
  reorder_level INTEGER DEFAULT 5,
  duration INTEGER DEFAULT 0, -- Only for services (minutes)
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CUSTOMERS
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  address TEXT,
  lifetime_spend DECIMAL(15,2) DEFAULT 0,
  loyalty_tier TEXT DEFAULT 'Standard',
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPLIERS
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  category TEXT,
  lead_time TEXT,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FINANCIAL TRANSACTIONS (Unified Ledger)
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount <> 0),
  type tx_type NOT NULL,
  category TEXT DEFAULT 'General',
  reference_id UUID, -- Link to Invoice/Sale/Payment
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVOICES
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  type TEXT NOT NULL,
  status invoice_status DEFAULT 'Pending' NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax DECIMAL(15,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  vat_included BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, invoice_number)
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices ON DELETE CASCADE NOT NULL,
  catalog_item_id UUID REFERENCES catalog_items ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(15,2) NOT NULL DEFAULT 0
);

-- PAYMENTS
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  invoice_id UUID REFERENCES invoices ON DELETE CASCADE,
  customer_id UUID REFERENCES customers ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SALES (POS)
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers ON DELETE SET NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT NOT NULL,
  receipt_number SERIAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID REFERENCES sales ON DELETE CASCADE NOT NULL,
  catalog_item_id UUID REFERENCES catalog_items ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  total_price DECIMAL(15,2) NOT NULL
);

-- HR: EMPLOYEES
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT,
  department TEXT,
  base_salary DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HR: ATTENDANCE
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  employee_id UUID REFERENCES employees ON DELETE CASCADE NOT NULL,
  check_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out TIMESTAMPTZ,
  status TEXT DEFAULT 'Present',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTIFICATIONS
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- LOW_STOCK, PAYMENT_RECEIVED, etc
  read_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOGS
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SECURITY & RLS

-- Helper: Check if user belongs to business
CREATE OR REPLACE FUNCTION check_business_access(target_business_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM business_members 
    WHERE business_id = target_business_id 
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on all tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- UNIVERSAL POLICIES (TENANT ISOLATION)
CREATE POLICY tenant_isolation_businesses ON businesses FOR ALL USING (owner_uid = auth.uid() OR check_business_access(id));
CREATE POLICY tenant_isolation_members ON business_members FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_catalog ON catalog_items FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_customers ON customers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_suppliers ON suppliers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_ledger ON financial_transactions FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_invoices ON invoices FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_invoice_items ON invoice_items FOR ALL USING (EXISTS (SELECT 1 FROM invoices WHERE id = invoice_id AND check_business_access(business_id)));
CREATE POLICY tenant_isolation_payments ON payments FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_sales ON sales FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_sale_items ON sale_items FOR ALL USING (EXISTS (SELECT 1 FROM sales WHERE id = sale_id AND check_business_access(business_id)));
CREATE POLICY tenant_isolation_employees ON employees FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_attendance ON attendance FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation_notifications ON notifications FOR ALL USING (user_id = auth.uid());
CREATE POLICY tenant_isolation_audit ON audit_logs FOR ALL USING (check_business_access(business_id));

-- 6. INDEXES FOR PERFORMANCE
CREATE INDEX idx_members_user ON business_members(user_id);
CREATE INDEX idx_catalog_biz ON catalog_items(business_id);
CREATE INDEX idx_ledger_biz_date ON financial_transactions(business_id, date DESC);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at) WHERE read_at IS NULL;

-- 7. ATOMIC BUSINESS FUNCTIONS (RPCs)

-- Process POS Sale
CREATE OR REPLACE FUNCTION process_sale(
  p_business_id UUID,
  p_customer_id UUID,
  p_items JSONB, -- Array of {id, quantity, price}
  p_payment_method TEXT,
  p_total_amount DECIMAL
) RETURNS UUID AS $$
DECLARE
  v_sale_id UUID;
  v_item RECORD;
BEGIN
  -- CRITICAL SECURITY FIX: Internal authorization check
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied to Business Ledger';
  END IF;

  -- 1. Create Sale Record
  INSERT INTO sales (business_id, customer_id, total_amount, payment_method)
  VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- 2. Process Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, quantity INTEGER, price DECIMAL)
  LOOP
    -- Insert Sale Item
    INSERT INTO sale_items (sale_id, catalog_item_id, quantity, unit_price, total_price)
    VALUES (v_sale_id, v_item.id, v_item.quantity, v_item.price, v_item.price * v_item.quantity);

    -- Update Stock (Atomic decrement)
    UPDATE catalog_items 
    SET quantity = quantity - v_item.quantity, updated_at = NOW()
    WHERE id = v_item.id AND business_id = p_business_id;
    
    -- Safety Check
    IF (SELECT quantity FROM catalog_items WHERE id = v_item.id) < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_item.id;
    END IF;
  END LOOP;

  -- 3. Record Ledger Entry
  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_id, created_by)
  VALUES (p_business_id, 'POS Sale #' || v_sale_id, p_total_amount, 'Income', 'Sales', v_sale_id, auth.uid());

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic Payment Recording
CREATE OR REPLACE FUNCTION record_payment_atomic(
  p_business_id UUID,
  p_invoice_id UUID,
  p_customer_id UUID,
  p_amount DECIMAL,
  p_payment_method TEXT,
  p_reference TEXT
) RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
  v_line_item RECORD;
BEGIN
  -- CRITICAL SECURITY FIX: Internal authorization check
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied to Business Ledger';
  END IF;

  -- 1. Record Payment
  INSERT INTO payments (business_id, invoice_id, customer_id, amount, method, reference)
  VALUES (p_business_id, p_invoice_id, p_customer_id, p_amount, p_payment_method, p_reference)
  RETURNING id INTO v_payment_id;

  -- 2. Update Invoice Status
  UPDATE invoices 
  SET status = 'Paid', updated_at = NOW() 
  WHERE id = p_invoice_id AND business_id = p_business_id;

  -- 3. Record Ledger Entry
  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_id, created_by)
  VALUES (p_business_id, 'Invoice Payment: ' || p_invoice_id, p_amount, 'Income', 'Sales', v_payment_id, auth.uid());

  -- 4. Atomic Inventory Sync (Fulfillment)
  FOR v_line_item IN SELECT catalog_item_id, quantity FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    IF v_line_item.catalog_item_id IS NOT NULL THEN
       UPDATE catalog_items 
       SET quantity = quantity - v_line_item.quantity, updated_at = NOW()
       WHERE id = v_line_item.catalog_item_id AND type = 'Product';
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Invoice Atomic (Header + Items)
CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_business_id UUID,
  p_customer_id UUID,
  p_invoice_number TEXT,
  p_type TEXT,
  p_status invoice_status,
  p_date DATE,
  p_due_date DATE,
  p_subtotal DECIMAL,
  p_tax DECIMAL,
  p_total DECIMAL,
  p_vat_included BOOLEAN,
  p_notes TEXT,
  p_items JSONB -- Array of {catalog_item_id, item_name, quantity, unit_price, total_price}
) RETURNS UUID AS $$
DECLARE
  v_invoice_id UUID;
  v_item RECORD;
BEGIN
  -- CRITICAL SECURITY FIX: Internal authorization check
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  -- 1. Create Invoice Header
  INSERT INTO invoices (business_id, customer_id, invoice_number, type, status, date, due_date, subtotal, tax, total, vat_included, notes)
  VALUES (p_business_id, p_customer_id, p_invoice_number, p_type, p_status, p_date, p_due_date, p_subtotal, p_tax, p_total, p_vat_included, p_notes)
  RETURNING id INTO v_invoice_id;

  -- 2. Create Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(catalog_item_id UUID, item_name TEXT, quantity INTEGER, unit_price DECIMAL, total_price DECIMAL)
  LOOP
    INSERT INTO invoice_items (invoice_id, catalog_item_id, item_name, quantity, unit_price, total_price)
    VALUES (v_invoice_id, v_item.catalog_item_id, v_item.item_name, v_item.quantity, v_item.unit_price, v_item.total_price);
  END LOOP;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. ANALYTICS VIEWS (Optimized for Reports)

CREATE VIEW view_inventory_valuation AS
SELECT 
  business_id,
  COUNT(*) as total_skus,
  SUM(price * quantity) as total_asset_value,
  COUNT(*) FILTER (WHERE quantity <= reorder_level) as low_stock_count
FROM catalog_items
WHERE type = 'Product'
GROUP BY business_id;

CREATE VIEW view_product_performance AS
SELECT 
  s.business_id,
  ci.name as product_name,
  ci.sku,
  SUM(si.quantity) as units_sold,
  SUM(si.total_price) as total_revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN catalog_items ci ON ci.id = si.catalog_item_id
GROUP BY s.business_id, ci.name, ci.sku;

CREATE VIEW view_receivables_aging AS
SELECT
  business_id,
  customer_id,
  invoice_number,
  total,
  due_date,
  CURRENT_DATE - due_date as days_overdue,
  CASE
    WHEN CURRENT_DATE - due_date <= 0 THEN 'Current'
    WHEN CURRENT_DATE - due_date <= 30 THEN '1-30 Days'
    WHEN CURRENT_DATE - due_date <= 60 THEN '31-60 Days'
    WHEN CURRENT_DATE - due_date <= 90 THEN '61-90 Days'
    ELSE '90+ Days'
  END as aging_bucket
FROM invoices
WHERE status IN ('Pending', 'Unpaid') AND type = 'Invoice';

-- 9. ANALYTICS FUNCTIONS (RPCs)

-- Dashboard KPIs
CREATE OR REPLACE FUNCTION get_business_kpis(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  total_income DECIMAL,
  total_expense DECIMAL,
  net_profit DECIMAL,
  transaction_count BIGINT
) AS $$
BEGIN
  -- CRITICAL SECURITY FIX: Internal authorization check
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) as total_income,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) as total_expense,
    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0) as net_profit,
    COUNT(*) as transaction_count
  FROM financial_transactions
  WHERE business_id = p_business_id
  AND date >= p_start_date
  AND date <= p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revenue Trend
CREATE OR REPLACE FUNCTION get_revenue_trend(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_interval TEXT -- 'day', 'week', 'month'
) RETURNS TABLE (
  period TEXT,
  income DECIMAL,
  expense DECIMAL
) AS $$
BEGIN
  -- CRITICAL SECURITY FIX: Internal authorization check
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT 
    to_char(date_trunc(p_interval, date), 
      CASE 
        WHEN p_interval = 'day' THEN 'YYYY-MM-DD'
        WHEN p_interval = 'week' THEN 'IYYY-IW'
        ELSE 'YYYY-MM'
      END) as period,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) as income,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) as expense
  FROM financial_transactions
  WHERE business_id = p_business_id
  AND date >= p_start_date
  AND date <= p_end_date
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
