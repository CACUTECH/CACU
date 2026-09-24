
-- CACU Production Schema Base
-- Multi-tenant isolation enforced via business_id and RLS

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- Profiles (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Businesses (Tenants)
CREATE TABLE IF NOT EXISTS public.businesses (
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Business Membership (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Editor', 'Viewer')),
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Pending', 'Inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

-- Catalog Items (Products & Services)
CREATE TABLE IF NOT EXISTS public.catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Product', 'Service', 'Package')),
  category TEXT,
  sku TEXT,
  price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 5,
  duration INTEGER, -- for services
  status TEXT DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID, -- Optional link to customers table
  invoice_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Invoice', 'Receipt', 'Estimate', 'CreditMemo')),
  status TEXT NOT NULL DEFAULT 'Pending',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  vat_included BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, invoice_number)
);

-- Invoice Items
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES public.catalog_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(15, 2) NOT NULL DEFAULT 0
);

-- Sales (POS Master)
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID,
  total_amount NUMERIC(15, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sale Items (POS Details)
CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.catalog_items(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(15, 2) NOT NULL,
  total_price NUMERIC(15, 2) NOT NULL
);

-- Financial Transactions (General Ledger)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Income', 'Expense')),
  category TEXT NOT NULL,
  reference_id UUID, -- Link to sale_id, invoice_id, etc.
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id),
  customer_id UUID,
  amount NUMERIC(15, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ATOMIC FUNCTIONS (RPCs)

-- Process POS Sale (Atomically updates ledger and inventory)
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
  INSERT INTO public.sales (business_id, customer_id, total_amount, payment_method)
  VALUES (p_business_id, p_customer_id, p_total_amount, p_payment_method)
  RETURNING id INTO v_sale_id;

  -- 2. Process Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id UUID, quantity INTEGER, price NUMERIC)
  LOOP
    -- Insert into sale_items
    INSERT INTO public.sale_items (sale_id, item_id, quantity, unit_price, total_price)
    VALUES (v_sale_id, v_item.id, v_item.quantity, v_item.price, (v_item.quantity * v_item.price));

    -- Decrement stock (only if it's a product)
    UPDATE public.catalog_items
    SET quantity = quantity - v_item.quantity,
        updated_at = NOW()
    WHERE id = v_item.id AND type = 'Product' AND business_id = p_business_id;
    
    -- Safety check for stock
    IF (SELECT quantity FROM public.catalog_items WHERE id = v_item.id) < 0 THEN
       RAISE EXCEPTION 'Insufficient stock for item %', v_item.id;
    END IF;
  END LOOP;

  -- 3. Record Financial Transaction (Income)
  INSERT INTO public.financial_transactions (business_id, description, amount, type, category, reference_id)
  VALUES (p_business_id, 'POS Sale #' || v_sale_id, p_total_amount, 'Income', 'Sales', v_sale_id);

  RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Invoice Atomically
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
  v_item RECORD;
BEGIN
  -- 1. Insert Invoice Header
  INSERT INTO public.invoices (
    business_id, customer_id, invoice_number, type, status, 
    date, due_date, subtotal, tax, total, vat_included, notes
  )
  VALUES (
    p_business_id, p_customer_id, p_invoice_number, p_type, p_status,
    p_date, p_due_date, p_subtotal, p_tax, p_total, p_vat_included, p_notes
  )
  RETURNING id INTO v_invoice_id;

  -- 2. Insert Invoice Items
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(item_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, catalog_item_id UUID)
  LOOP
    INSERT INTO public.invoice_items (invoice_id, item_name, quantity, unit_price, total_price, catalog_item_id)
    VALUES (v_invoice_id, v_item.item_name, v_item.quantity, v_item.unit_price, v_item.total_price, v_item.catalog_item_id);
  END LOOP;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record Payment Atomically (Updates Invoice, Ledger, and Inventory)
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
  -- 1. Record the payment
  INSERT INTO public.payments (business_id, invoice_id, customer_id, amount, payment_method, reference)
  VALUES (p_business_id, p_invoice_id, p_customer_id, p_amount, p_payment_method, p_reference)
  RETURNING id INTO v_payment_id;

  -- 2. Update Invoice status
  UPDATE public.invoices
  SET status = 'Paid', updated_at = NOW()
  WHERE id = p_invoice_id AND business_id = p_business_id;

  -- 3. Record Ledger Entry
  INSERT INTO public.financial_transactions (business_id, description, amount, type, category, reference_id)
  VALUES (p_business_id, 'Payment for Invoice #' || p_invoice_id, p_amount, 'Income', 'Invoices', p_invoice_id);

  -- 4. Sync Inventory (Deduct stock for products)
  FOR v_item IN SELECT catalog_item_id, quantity FROM public.invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NOT NULL THEN
      UPDATE public.catalog_items
      SET quantity = quantity - v_item.quantity,
          updated_at = NOW()
      WHERE id = v_item.catalog_item_id AND type = 'Product' AND business_id = p_business_id;
    END IF;
  END LOOP;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
