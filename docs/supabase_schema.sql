
-- CACU PRODUCTION SCHEMA (RELATIONAL MIGRATION)

-- 1. PROFILES (Linked to Supabase Auth)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. BUSINESSES (Root Tenant)
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    business_type TEXT DEFAULT 'HYBRID' CHECK (business_type IN ('PRODUCT', 'SERVICE', 'HYBRID')),
    sector TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logo_url TEXT,
    bank_name TEXT,
    account_number TEXT,
    account_name TEXT,
    subscription_tier TEXT DEFAULT 'Starter' CHECK (subscription_tier IN ('Starter', 'Growth', 'Enterprise')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. MEMBERSHIPS (RBAC)
CREATE TABLE business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Pending', 'Suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(business_id, user_id)
);

-- 4. SECURITY HELPERS
CREATE OR REPLACE FUNCTION check_business_access(target_business_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = target_business_id
    AND user_id = auth.uid()
    AND status = 'Active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CATALOG (Inventory & Services)
CREATE TABLE catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('Product', 'Service')),
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    sku TEXT,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 5,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. CUSTOMERS
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    loyalty_tier TEXT DEFAULT 'New',
    lifetime_spend NUMERIC DEFAULT 0,
    last_active DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. SUPPLIERS
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    lead_time_days INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. LEDGER (High Integrity Financial Records)
CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
    category TEXT NOT NULL,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. HR (Employees)
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL,
    department TEXT,
    base_salary NUMERIC NOT NULL DEFAULT 0,
    bank_name TEXT,
    account_number TEXT,
    pension_id TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. ATTENDANCE
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    check_in_time TEXT,
    check_out_time TEXT,
    duration_minutes INTEGER,
    status TEXT DEFAULT 'On Time',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. AUDIT LOGS
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS POLICIES (TENANT ISOLATION)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view businesses they belong to" ON businesses FOR SELECT 
    USING (EXISTS (SELECT 1 FROM business_members WHERE business_id = businesses.id AND user_id = auth.uid()));

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view business members" ON business_members FOR SELECT 
    USING (business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid()));

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for catalog" ON catalog_items FOR ALL USING (check_business_access(business_id));

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for customers" ON customers FOR ALL USING (check_business_access(business_id));

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for suppliers" ON suppliers FOR ALL USING (check_business_access(business_id));

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for ledger" ON financial_transactions FOR ALL USING (check_business_access(business_id));

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for employees" ON employees FOR ALL USING (check_business_access(business_id));

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for attendance" ON attendance FOR ALL USING (check_business_access(business_id));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for audit" ON audit_logs FOR SELECT USING (check_business_access(business_id));

-- INDEXES
CREATE INDEX idx_members_user ON business_members(user_id);
CREATE INDEX idx_catalog_biz ON catalog_items(business_id);
CREATE INDEX idx_customers_biz ON customers(business_id);
CREATE INDEX idx_ledger_biz ON financial_transactions(business_id);
CREATE INDEX idx_ledger_date ON financial_transactions(date);
CREATE INDEX idx_employees_biz ON employees(business_id);
