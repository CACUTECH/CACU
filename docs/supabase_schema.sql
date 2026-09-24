
-- CACU Production Relational Schema (PostgreSQL)
-- Supports Multi-Tenant Isolation, Financial Integrity, and HR Lifecycle

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CORE IDENTITY & MEMBERSHIP
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN ('PRODUCT', 'SERVICE', 'HYBRID')),
  sector TEXT,
  address TEXT,
  logo_url TEXT,
  email TEXT,
  phone TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  subscription_level TEXT DEFAULT 'Starter' CHECK (subscription_level IN ('Starter', 'Growth', 'Enterprise')),
  owner_uid UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, user_id)
);

-- 3. CRM & SUPPLY CHAIN
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  address TEXT,
  lifetime_spend NUMERIC DEFAULT 0,
  loyalty_tier TEXT DEFAULT 'Standard',
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  category TEXT,
  lead_time TEXT,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. UNIFIED CATALOG (PRODUCTS & SERVICES)
CREATE TABLE catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Product', 'Service', 'Package')),
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  description TEXT,
  price NUMERIC NOT NULL CHECK (price >= 0),
  quantity INTEGER DEFAULT 0, -- Relevant for Products
  reorder_level INTEGER DEFAULT 5,
  duration INTEGER, -- Relevant for Services (minutes)
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. FINANCIAL LEDGER (THE TRUTH)
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount <> 0),
  type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
  category TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. POS & SALES
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  total_amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'Transfer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES catalog_items(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL
);

-- 7. BILLING (INVOICES)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  invoice_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Invoice', 'Receipt', 'Estimate', 'CreditMemo')),
  status TEXT NOT NULL DEFAULT 'Pending',
  date DATE NOT NULL,
  due_date DATE,
  subtotal NUMERIC NOT NULL,
  tax NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  vat_included BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, invoice_number)
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES catalog_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. HR & PERSONNEL
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT,
  department TEXT,
  base_salary NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  check_in TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out TIMESTAMPTZ,
  status TEXT DEFAULT 'Present'
);

-- 9. NOTIFICATIONS
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- 'LOW_STOCK', 'PAYMENT_RECEIVED', 'SYSTEM'
  channel TEXT NOT NULL DEFAULT 'IN_APP', -- 'IN_APP', 'EMAIL'
  status TEXT NOT NULL DEFAULT 'PENDING',
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. AUDIT LOGS
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS POLICIES & SECURITY
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Shared function to check business access
CREATE OR REPLACE FUNCTION check_business_access(b_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id AND user_id = auth.uid() AND status = 'Active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example Global Policy
CREATE POLICY tenant_isolation ON customers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON catalog_items FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON financial_transactions FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON invoices FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON notifications FOR ALL USING (auth.uid() = user_id);

-- ATOMIC STORED PROCEDURES (RPCs)
CREATE OR REPLACE FUNCTION process_sale(
  p_business_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_payment_method TEXT,
  p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
  v_sale_id UUID;
  v_item RECORD;
BEGIN
  -- 1. Create Sale Record
  INSERT INTO sales (business_id, customer_id, total_amount, payment_method)
  VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- 2. Create Sale Items & Update Stock
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, name TEXT, quantity INTEGER, price NUMERIC)
  LOOP
    INSERT INTO sale_items (sale_id, catalog_item_id, quantity, unit_price)
    VALUES (v_sale_id, v_item.id, v_item.quantity, v_item.price);

    UPDATE catalog_items
    SET quantity = quantity - v_item.quantity
    WHERE id = v_item.id AND business_id = p_business_id;
    
    -- Safety: If stock goes negative, Postgres will throw an error if CHECK is added
  END LOOP;

  -- 3. Create Ledger Entry
  INSERT INTO financial_transactions (business_id, description, amount, type, category)
  VALUES (p_business_id, 'POS Sale: ' || v_sale_id, p_total_amount, 'Income', 'Retail Sales');

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  v_item RECORD;
BEGIN
  -- 1. Record Payment
  INSERT INTO payments (business_id, invoice_id, amount, payment_method, reference)
  VALUES (p_business_id, p_invoice_id, p_amount, p_payment_method, p_reference)
  RETURNING id INTO v_payment_id;

  -- 2. Update Invoice Status
  UPDATE invoices
  SET status = 'Paid', updated_at = now()
  WHERE id = p_invoice_id AND business_id = p_business_id;

  -- 3. Sync Ledger
  INSERT INTO financial_transactions (business_id, description, amount, type, category)
  VALUES (p_business_id, 'Invoice Payment: ' || p_invoice_id, p_amount, 'Income', 'Receivables');

  -- 4. Optional: Auto-decrement stock for Product items on this invoice
  FOR v_item IN SELECT catalog_item_id, quantity FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NOT NULL THEN
        UPDATE catalog_items
        SET quantity = quantity - v_item.quantity
        WHERE id = v_item.catalog_item_id AND business_id = p_business_id AND type = 'Product';
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
