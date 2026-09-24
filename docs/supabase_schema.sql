
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create businesses table
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  business_type text check (business_type in ('PRODUCT', 'SERVICE', 'HYBRID')),
  sector text,
  address text,
  email text,
  phone text,
  bank_name text,
  account_number text,
  account_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create profiles table (linked to auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create business_members table (many-to-many)
create table business_members (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid references businesses on delete cascade not null,
  user_id uuid references profiles on delete cascade not null,
  role text not null check (role in ('Owner', 'Admin', 'Editor', 'Viewer')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(business_id, user_id)
);

-- Enable RLS
alter table businesses enable row level security;
alter table profiles enable row level security;
alter table business_members enable row level security;

-- Simple RLS Policies (to be refined)
create policy "Users can view their own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = id);

create policy "Members can view their businesses" on businesses for select using (
  exists (
    select 1 from business_members 
    where business_members.business_id = businesses.id 
    and business_members.user_id = auth.uid()
  )
);

create policy "Members can view membership" on business_members for select using (user_id = auth.uid());
