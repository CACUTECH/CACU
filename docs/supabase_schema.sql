-- CACU PRODUCTION RELATIONAL SCHEMA
-- Multi-tenant architecture for Nigerian MSMEs

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. BUSINESSES (ROOT TENANT)
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sector text,
  address text,
  email text,
  phone text,
  logo_url text,
  business_type text check (business_type in ('PRODUCT', 'SERVICE', 'HYBRID')) not null,
  subscription_tier text check (subscription_tier in ('Starter', 'Growth', 'Enterprise')) default 'Starter',
  bank_name text,
  account_number text,
  account_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. PROFILES (USER IDENTITY)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text unique not null,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. BUSINESS MEMBERS (RBAC & TENANCY LINK)
create table business_members (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  user_id uuid references profiles on delete cascade not null,
  role text check (role in ('Owner', 'Admin', 'Editor', 'Viewer')) not null,
  created_at timestamptz default now(),
  unique(business_id, user_id)
);

-- 5. CATALOG (PRODUCTS & SERVICES)
create table catalog_items (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  type text check (type in ('Product', 'Service')) not null,
  name text not null,
  sku text,
  category text,
  description text,
  price decimal(12,2) not null default 0,
  quantity integer default 0,
  reorder_level integer default 10,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. TRANSACTIONS (LEDGER)
create table transactions (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  date date not null default current_date,
  description text not null,
  amount decimal(12,2) not null,
  type text check (type in ('Income', 'Expense')) not null,
  category text,
  account text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- 7. ROW LEVEL SECURITY (RLS)

-- Helper: Check if user belongs to a business
create or replace function check_business_access(target_business_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from business_members
    where business_id = target_business_id
    and user_id = auth.uid()
  );
end;
$$ language plpgsql security definer;

-- Enable RLS
alter table businesses enable row level security;
alter table profiles enable row level security;
alter table business_members enable row level security;
alter table catalog_items enable row level security;
alter table transactions enable row level security;

-- Policies: Businesses
create policy "Users can view businesses they belong to"
  on businesses for select
  using (check_business_access(id));

-- Policies: Profiles
create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Policies: Catalog Items
create policy "Tenant isolation for catalog"
  on catalog_items for all
  using (check_business_access(business_id));

-- Policies: Transactions
create policy "Tenant isolation for transactions"
  on transactions for all
  using (check_business_access(business_id));
