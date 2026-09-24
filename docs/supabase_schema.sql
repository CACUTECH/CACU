
-- CACU PRODUCTION SCHEMA (COMPREHENSIVE)
-- This file contains all tables for the migrated modules.

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. BUSINESSES & PROFILES
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    business_type TEXT NOT NULL CHECK (business_type IN ('PRODUCT', 'SERVICE', 'HYBRID')),
    sector TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    bank_name TEXT,
    account_number TEXT,
    account_name TEXT,
    logo_url TEXT,
    subscription_tier TEXT DEFAULT 'Starter',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);

-- 2. CORE OPERATIONAL DATA
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    lifetime_spend NUMERIC DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'Bronze',
    last_active TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('Product', 'Service', 'Package')),
    name TEXT NOT NULL,
    category TEXT,
    sku TEXT,
    price NUMERIC NOT NULL CHECK (price >= 0),
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 5,
    duration INTEGER, -- For services (minutes)
    pricing_model TEXT DEFAULT 'Fixed',
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FINANCIALS & LEDGER
CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount <> 0),
    type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
    category TEXT NOT NULL,
    reference_id UUID, -- Link to Sale, Invoice, or Purchase
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Invoice', 'Estimate', 'Receipt', 'CreditMemo')),
    status TEXT NOT NULL CHECK (status IN ('Draft', 'Pending', 'Paid', 'Accepted', 'Refunded', 'Cancelled')),
    date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax NUMERIC NOT NULL DEFAULT 0,
    total NUMERIC NOT NULL DEFAULT 0,
    vat_included BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, invoice_number)
);

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC NOT NULL
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    reference TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    total_amount NUMERIC NOT NULL,
    payment_method TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    item_id UUID REFERENCES catalog_items(id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL
);

-- RLS CONFIGURATION
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER HELPERS
CREATE OR REPLACE FUNCTION check_business_access(b_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id AND user_id = auth.uid() AND status = 'Active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- POLICIES
CREATE POLICY tenant_isolation ON customers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON suppliers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON catalog_items FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON financial_transactions FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON invoices FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON payments FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON sales FOR ALL USING (check_business_access(business_id));

-- ATOMIC POS FUNCTION
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
  -- 1. Insert Sale
  INSERT INTO sales (business_id, customer_id, total_amount, payment_method)
  VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- 2. Process Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, quantity INTEGER, price NUMERIC)
  LOOP
    -- Insert Sale Item
    INSERT INTO sale_items (sale_id, item_id, quantity, unit_price, total_price)
    VALUES (v_sale_id, v_item.id, v_item.quantity, v_item.price, v_item.quantity * v_item.price);

    -- Update Stock
    UPDATE catalog_items
    SET quantity = quantity - v_item.quantity
    WHERE id = v_item.id AND business_id = p_business_id;
  END LOOP;

  -- 3. Record in Ledger
  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_id)
  VALUES (p_business_id, 'POS Sale: ' || v_sale_id, p_total_amount, 'Income', 'Sales', v_sale_id);

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
