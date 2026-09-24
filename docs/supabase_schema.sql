
-- CACU PRODUCTION RELATIONAL SCHEMA
-- Platform: Supabase / PostgreSQL 15+
-- Isolation Model: Multi-tenant via Row Level Security (RLS)

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. CORE IDENTITY & TENANCY
-- ==========================================

-- User Profiles (Applications-level extension of auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Businesses (The primary tenant entity)
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    business_type TEXT CHECK (business_type IN ('PRODUCT', 'SERVICE', 'HYBRID')) DEFAULT 'HYBRID' NOT NULL,
    sector TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logo_url TEXT,
    subscription_tier TEXT CHECK (subscription_tier IN ('Starter', 'Growth', 'Enterprise')) DEFAULT 'Starter' NOT NULL,
    bank_name TEXT,
    account_number TEXT,
    account_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Business Membership & RBAC
CREATE TABLE IF NOT EXISTS public.business_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    role TEXT CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')) DEFAULT 'Viewer' NOT NULL,
    status TEXT CHECK (status IN ('Active', 'Pending', 'Inactive')) DEFAULT 'Active' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(business_id, user_id)
);

-- ==========================================
-- 2. OPERATIONS (Inventory & Services)
-- ==========================================

-- Catalog (Replaces legacy flat catalog collection)
CREATE TABLE IF NOT EXISTS public.catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('Product', 'Service')) NOT NULL,
    category TEXT,
    description TEXT,
    price DECIMAL(15,2) DEFAULT 0 NOT NULL,
    sku TEXT,
    quantity INTEGER DEFAULT 0, -- Current stock level
    reorder_level INTEGER DEFAULT 10,
    duration_mins INTEGER, -- For services
    pricing_model TEXT CHECK (pricing_model IN ('Fixed', 'Hourly', 'Project')) DEFAULT 'Fixed',
    status TEXT DEFAULT 'Active' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- 3. CRM & FINANCE
-- ==========================================

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    address TEXT,
    loyalty_tier TEXT DEFAULT 'New',
    lifetime_spend DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Unified Ledger (Financial Transactions)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    type TEXT CHECK (type IN ('Income', 'Expense')) NOT NULL,
    category TEXT NOT NULL,
    account TEXT DEFAULT 'Business Checking' NOT NULL,
    reference_id TEXT, -- Link to invoices/receipts
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Sales & Invoices
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    status TEXT CHECK (status IN ('Draft', 'Pending', 'Paid', 'Overdue', 'Cancelled')) DEFAULT 'Pending' NOT NULL,
    issue_date DATE DEFAULT CURRENT_DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(15,2) DEFAULT 0 NOT NULL,
    tax_amount DECIMAL(15,2) DEFAULT 0 NOT NULL,
    total_amount DECIMAL(15,2) DEFAULT 0 NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(business_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
    item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1 NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    total_price DECIMAL(15,2) NOT NULL
);

-- ==========================================
-- 4. HUMAN RESOURCES
-- ==========================================

-- Employee Records
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    department TEXT,
    base_salary DECIMAL(15,2) NOT NULL,
    bank_name TEXT,
    account_number TEXT,
    tin TEXT,
    pension_id TEXT,
    status TEXT CHECK (status IN ('Active', 'On Probation', 'Terminated', 'On Notice')) DEFAULT 'Active' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Attendance Logs
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE NOT NULL,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status TEXT DEFAULT 'On Time',
    location_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- 5. AUDIT & LOGGING
-- ==========================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    entity_id UUID NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ==========================================
-- 6. SECURITY & AUTHORIZATION (RLS)
-- ==========================================

-- Helper Function: Check Business Access
CREATE OR REPLACE FUNCTION public.check_business_access(target_business_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = target_business_id
    AND user_id = auth.uid()
    AND status = 'Active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: Own user only
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Businesses: Members can view
CREATE POLICY "Members can view business profile" ON public.businesses FOR SELECT USING (check_business_access(id));
CREATE POLICY "Owners/Admins can update business" ON public.businesses FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.business_members WHERE business_id = id AND user_id = auth.uid() AND role IN ('Owner', 'Admin'))
);

-- Generic Multi-Tenant Policy (Members can see data)
CREATE POLICY "Multi-tenant View" ON public.catalog_items FOR SELECT USING (check_business_access(business_id));
CREATE POLICY "Multi-tenant View" ON public.customers FOR SELECT USING (check_business_access(business_id));
CREATE POLICY "Multi-tenant View" ON public.financial_transactions FOR SELECT USING (check_business_access(business_id));
CREATE POLICY "Multi-tenant View" ON public.invoices FOR SELECT USING (check_business_access(business_id));
CREATE POLICY "Multi-tenant View" ON public.employees FOR SELECT USING (check_business_access(business_id));
CREATE POLICY "Multi-tenant View" ON public.attendance FOR SELECT USING (check_business_access(business_id));

-- Modification Policies (Owners, Admins, Editors)
CREATE POLICY "Staff can modify operational data" ON public.catalog_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.business_members WHERE business_id = catalog_items.business_id AND user_id = auth.uid() AND role IN ('Owner', 'Admin', 'Editor'))
);

CREATE POLICY "Staff can modify financial data" ON public.financial_transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.business_members WHERE business_id = financial_transactions.business_id AND user_id = auth.uid() AND role IN ('Owner', 'Admin', 'Editor'))
);

-- ==========================================
-- 7. PERFORMANCE INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_members_user ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_catalog_business ON public.catalog_items(business_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_business_date ON public.financial_transactions(business_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_business ON public.invoices(business_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_business ON public.employees(business_id);
