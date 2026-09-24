
-- CACU Production Relational Schema (PostgreSQL)
-- Optimized for scale (1M+ Users)

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For high-speed fuzzy search

-- 2. CORE IDENTITY
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_type TEXT DEFAULT 'HYBRID', -- PRODUCT, SERVICE, HYBRID
  sector TEXT,
  address TEXT,
  logo_url TEXT,
  email TEXT,
  phone TEXT,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  owner_uid UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- INDEX: Fast lookup of business by owner
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_uid);

CREATE TABLE IF NOT EXISTS business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer', -- Owner, Admin, Editor, Viewer, HR, Auditor
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, user_id)
);

-- INDEX: Crucial for multi-tenant isolation performance
CREATE INDEX IF NOT EXISTS idx_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_biz ON business_members(business_id);

-- 3. CRM & CATALOG
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  company TEXT,
  lifetime_spend NUMERIC(15,2) DEFAULT 0,
  loyalty_tier TEXT DEFAULT 'Standard',
  last_active TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEX: Multi-tenant fuzzy search on customers
CREATE INDEX IF NOT EXISTS idx_customers_biz_name ON customers(business_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- Product, Service
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  price NUMERIC(15,2) NOT NULL DEFAULT 0,
  sku TEXT,
  quantity INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 5,
  duration INTEGER DEFAULT 0, -- mins for services
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEX: Performance for inventory low-stock alerts
CREATE INDEX IF NOT EXISTS idx_catalog_biz_status ON catalog_items(business_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_stock_check ON catalog_items(business_id, quantity) WHERE type = 'Product';
CREATE INDEX IF NOT EXISTS idx_catalog_name_trgm ON catalog_items USING gin (name gin_trgm_ops);

-- 4. FINANCIAL LEDGER
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

-- INDEX: High-speed dashboard aggregation (Composite)
CREATE INDEX IF NOT EXISTS idx_tx_biz_date_type ON financial_transactions(business_id, date DESC, type);

-- 5. RETAIL & BILLING
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  total_amount NUMERIC(15,2) NOT NULL,
  payment_method TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES catalog_items(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(15,2) NOT NULL,
  total_price NUMERIC(15,2) NOT NULL
);

-- 6. AUDIT & LOGGING
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

-- 7. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id) WHERE read_at IS NULL;

-- 8. SECURITY & HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION check_business_access(p_business_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM business_members 
    WHERE business_id = p_business_id 
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. ATOMIC FINANCIAL PROCEDURES
CREATE OR REPLACE FUNCTION process_sale(
  p_business_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_payment_method TEXT,
  p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
  v_sale_id UUID;
  v_item JSONB;
BEGIN
  -- 1. Auth Guard
  IF NOT check_business_access(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  -- 2. Stock Validation (Row Locking)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM catalog_items 
      WHERE id = (v_item->>'id')::UUID 
      AND quantity >= (v_item->>'quantity')::INTEGER
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_item->>'name';
    END IF;
  END LOOP;

  -- 3. Create Sale
  INSERT INTO sales (business_id, customer_id, total_amount, payment_method)
  VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- 4. Record Items & Update Stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO sale_items (sale_id, catalog_item_id, name, quantity, unit_price, total_price)
    VALUES (
      v_sale_id, 
      (v_item->>'id')::UUID, 
      v_item->>'name', 
      (v_item->>'quantity')::INTEGER, 
      (v_item->>'price')::NUMERIC, 
      ((v_item->>'quantity')::INTEGER * (v_item->>'price')::NUMERIC)
    );

    UPDATE catalog_items 
    SET quantity = quantity - (v_item->>'quantity')::INTEGER
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  -- 5. Ledger Entry
  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_type, reference_id)
  VALUES (p_business_id, 'POS Sale: ' || v_sale_id, p_total_amount, 'Income', 'Sales', 'Sale', v_sale_id);

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. SCALABLE REPORTING FUNCTIONS
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
