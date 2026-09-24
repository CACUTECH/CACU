
-- CACU Production Schema (Supabase/PostgreSQL)
-- Optimized for 1M+ Users with Strict Multi-Tenancy

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CORE IDENTITY
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    business_type TEXT NOT NULL CHECK (business_type IN ('PRODUCT', 'SERVICE', 'HYBRID')),
    sector TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logo_url TEXT,
    bank_name TEXT,
    account_number TEXT,
    account_name TEXT,
    subscription_level TEXT DEFAULT 'Starter' CHECK (subscription_level IN ('Starter', 'Growth', 'Enterprise')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(business_id, user_id)
);

-- 3. CRM & SUPPLY CHAIN
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    lifetime_spend DECIMAL(15,2) DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'Standard',
    last_active TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    lead_time TEXT,
    category TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. OPERATIONS (CATALOG & INVENTORY)
CREATE TABLE IF NOT EXISTS catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('Product', 'Service', 'Package')),
    name TEXT NOT NULL,
    category TEXT,
    sku TEXT,
    description TEXT,
    price DECIMAL(15,2) NOT NULL DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    duration INTEGER, -- For services (minutes)
    pricing_model TEXT DEFAULT 'Fixed',
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. FINANCIALS
CREATE TABLE IF NOT EXISTS financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
    category TEXT NOT NULL,
    account TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. HR & PERSONNEL
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL,
    department TEXT,
    base_salary DECIMAL(15,2) DEFAULT 0,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'On Probation', 'Terminated', 'On Notice')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. SECURITY (RLS HELPER)
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

-- 8. APPLY POLICIES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their business" ON businesses FOR SELECT USING (check_business_access(id));

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view their teammates" ON business_members FOR SELECT USING (check_business_access(business_id));

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for customers" ON customers FOR ALL USING (check_business_access(business_id));

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for suppliers" ON suppliers FOR ALL USING (check_business_access(business_id));

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for catalog" ON catalog_items FOR ALL USING (check_business_access(business_id));

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for ledger" ON financial_transactions FOR ALL USING (check_business_access(business_id));

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for employees" ON employees FOR ALL USING (check_business_access(business_id));
