
-- CACU Production Schema - PostgreSQL
-- Supports Multi-tenancy, Row Level Security, and Financial Integrity

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CORE IDENTITY TABLES
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Pending', 'Inactive')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(business_id, user_id)
);

-- 3. OPERATIONAL TABLES
CREATE TABLE catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Product', 'Service', 'Package')),
    category TEXT,
    description TEXT,
    price DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    sku TEXT,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 5,
    duration INTEGER, -- in minutes for services
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    lifetime_spend DECIMAL(15,2) DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'Standard',
    last_active TIMESTAMPTZ DEFAULT NOW(),
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

-- 4. FINANCIAL TABLES
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    total_amount DECIMAL(15,2) NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT DEFAULT 'Completed',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    item_id UUID REFERENCES catalog_items(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    total_price DECIMAL(15,2) NOT NULL
);

CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    amount DECIMAL(15,2) NOT NULL CHECK (amount != 0),
    type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
    category TEXT NOT NULL,
    reference_id UUID, -- Links to sale_id or invoice_id
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. HR TABLES
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    department TEXT,
    cost_center TEXT,
    status TEXT DEFAULT 'Active',
    base_salary DECIMAL(15,2) DEFAULT 0,
    bank_name TEXT,
    account_number TEXT,
    tin TEXT,
    pension_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    location_verified BOOLEAN DEFAULT FALSE,
    UNIQUE(employee_id, date)
);

-- 6. SECURITY HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION check_business_access(target_biz_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM business_members
        WHERE business_id = target_biz_id
        AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. ATOMIC POS TRANSACTION FUNCTION
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
    -- 1. Create Sale
    INSERT INTO sales (business_id, customer_id, total_amount, payment_method, created_by)
    VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method, auth.uid())
    RETURNING id INTO v_sale_id;

    -- 2. Process Items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, quantity INTEGER, price DECIMAL)
    LOOP
        -- Insert Sale Item
        INSERT INTO sale_items (sale_id, item_id, quantity, unit_price, total_price)
        VALUES (v_sale_id, v_item.id, v_item.quantity, v_item.price, (v_item.quantity * v_item.price));

        -- Update Stock
        UPDATE catalog_items
        SET quantity = quantity - v_item.quantity,
            updated_at = NOW()
        WHERE id = v_item.id AND business_id = p_business_id;
    END LOOP;

    -- 3. Record in Ledger
    INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_id, created_by)
    VALUES (p_business_id, 'POS Sale: ' || v_sale_id, p_total_amount, 'Income', 'Sales', v_sale_id, auth.uid());

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Shared Tenant Policy Pattern
CREATE POLICY tenant_isolation ON businesses FOR ALL USING (check_business_access(id));
CREATE POLICY tenant_isolation ON business_members FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON catalog_items FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON customers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON suppliers FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON financial_transactions FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON sales FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON sale_items FOR ALL USING (
    EXISTS (SELECT 1 FROM sales WHERE sales.id = sale_id AND check_business_access(sales.business_id))
);
CREATE POLICY tenant_isolation ON employees FOR ALL USING (check_business_access(business_id));
CREATE POLICY tenant_isolation ON attendance FOR ALL USING (check_business_access(business_id));

-- Profiles Policy (User specific)
CREATE POLICY profile_access ON profiles FOR ALL USING (id = auth.uid());
