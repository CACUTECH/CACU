
-- CACU Production Relational Schema
-- Supports Multi-Tenancy via Row Level Security (RLS)

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS
CREATE TYPE public.business_model AS ENUM ('PRODUCT', 'SERVICE', 'HYBRID');
CREATE TYPE public.user_role AS ENUM ('Owner', 'Admin', 'Editor', 'Viewer');
CREATE TYPE public.item_type AS ENUM ('Product', 'Service');
CREATE TYPE public.transaction_type AS ENUM ('Income', 'Expense');

-- 3. TABLES

-- Profiles: Public user data linked to Auth
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Businesses: The root of every tenant
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  business_type public.business_model DEFAULT 'HYBRID',
  sector text,
  address text,
  email text,
  phone text,
  bank_name text,
  account_number text,
  account_name text,
  logo_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Business Members: Many-to-many join table for users and businesses
CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid REFERENCES public.businesses ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role public.user_role DEFAULT 'Viewer' NOT NULL,
  status text DEFAULT 'Active' NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, user_id)
);

-- Catalog Items: Inventory and Services
CREATE TABLE public.catalog_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid REFERENCES public.businesses ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type public.item_type NOT NULL,
  category text,
  description text,
  sku text,
  price numeric(15, 2) NOT NULL DEFAULT 0,
  quantity integer DEFAULT 0,
  reorder_level integer DEFAULT 10,
  duration integer, -- for services
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Financial Transactions: The high-integrity ledger
CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid REFERENCES public.businesses ON DELETE CASCADE NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  amount numeric(15, 2) NOT NULL,
  type public.transaction_type NOT NULL,
  category text,
  account text DEFAULT 'Business Checking',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Employees: HR management
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid REFERENCES public.businesses ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  email text,
  role text,
  department text,
  base_salary numeric(15, 2) DEFAULT 0,
  bank_name text,
  account_number text,
  status text DEFAULT 'Active',
  created_at timestamptz DEFAULT now()
);

-- 4. SECURITY HELPERS
-- Function to check if current user is a member of a business
CREATE OR REPLACE FUNCTION public.check_business_access(target_business_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = target_business_id
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user role in a business
CREATE OR REPLACE FUNCTION public.get_business_role(target_business_id uuid)
RETURNS public.user_role AS $$
  SELECT role FROM public.business_members
  WHERE business_id = target_business_id
  AND user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5. ROW LEVEL SECURITY (RLS)

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Businesses
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view business profile" ON public.businesses
  FOR SELECT TO authenticated USING (public.check_business_access(id));
CREATE POLICY "Owners can update business" ON public.businesses
  FOR UPDATE TO authenticated USING (public.get_business_role(id) IN ('Owner', 'Admin'));

-- Business Members
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view fellow members" ON public.business_members
  FOR SELECT TO authenticated USING (public.check_business_access(business_id));
CREATE POLICY "Owners can manage members" ON public.business_members
  FOR ALL TO authenticated USING (public.get_business_role(business_id) IN ('Owner', 'Admin'));

-- Catalog Items
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view items" ON public.catalog_items
  FOR SELECT TO authenticated USING (public.check_business_access(business_id));
CREATE POLICY "Editors can manage items" ON public.catalog_items
  FOR ALL TO authenticated USING (public.get_business_role(business_id) IN ('Owner', 'Admin', 'Editor'));

-- Financial Transactions
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view transactions" ON public.financial_transactions
  FOR SELECT TO authenticated USING (public.check_business_access(business_id));
CREATE POLICY "Editors can create transactions" ON public.financial_transactions
  FOR INSERT TO authenticated WITH CHECK (public.get_business_role(business_id) IN ('Owner', 'Admin', 'Editor'));
CREATE POLICY "Admins can update/delete transactions" ON public.financial_transactions
  FOR UPDATE TO authenticated USING (public.get_business_role(business_id) IN ('Owner', 'Admin'));

-- Employees
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view employees" ON public.employees
  FOR SELECT TO authenticated USING (public.check_business_access(business_id));
CREATE POLICY "HR managers can manage employees" ON public.employees
  FOR ALL TO authenticated USING (public.get_business_role(business_id) IN ('Owner', 'Admin'));

-- 6. INDEXES for Performance
CREATE INDEX idx_members_user ON public.business_members(user_id);
CREATE INDEX idx_catalog_business ON public.catalog_items(business_id);
CREATE INDEX idx_transactions_business ON public.financial_transactions(business_id, date DESC);
CREATE INDEX idx_employees_business ON public.employees(business_id);
