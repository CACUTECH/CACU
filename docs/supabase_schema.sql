
-- CACU PRODUCTION RELATIONAL SCHEMA (PostgreSQL)
-- Optimized for Multi-Tenancy, Financial Integrity, and Scale

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. ENUMS
create type business_model as enum ('PRODUCT', 'SERVICE', 'HYBRID');
create type user_role as enum ('Owner', 'Admin', 'Editor', 'Viewer');
create type transaction_type as enum ('Income', 'Expense');
create type item_type as enum ('Product', 'Service', 'Package');
create type invoice_status as enum ('Draft', 'Pending', 'Paid', 'Accepted', 'Cancelled', 'Refunded');

-- 3. CORE TABLES
create table public.businesses (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    business_type business_model not null default 'HYBRID',
    sector text,
    address text,
    logo_url text,
    email text,
    phone text,
    bank_name text,
    account_number text,
    account_name text,
    subscription_level text default 'Starter',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table public.profiles (
    id uuid primary key references auth.users on delete cascade,
    email text unique not null,
    full_name text,
    avatar_url text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create table public.business_members (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    user_id uuid references public.profiles on delete cascade,
    role user_role not null default 'Viewer',
    status text default 'Active',
    unique(business_id, user_id)
);

-- 4. OPERATIONAL TABLES
create table public.customers (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    name text not null,
    email text,
    phone text,
    company text,
    address text,
    lifetime_spend decimal(15,2) default 0,
    loyalty_tier text default 'Standard',
    last_active timestamptz,
    created_at timestamptz default now()
);

create table public.suppliers (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    name text not null,
    contact_person text,
    phone text,
    email text,
    category text,
    lead_time text,
    created_at timestamptz default now()
);

create table public.catalog_items (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    type item_type not null default 'Product',
    name text not null,
    sku text,
    category text,
    price decimal(15,2) not null check (price >= 0),
    quantity integer default 0 check (quantity >= 0),
    reorder_level integer default 5,
    duration integer, -- for services
    status text default 'Active',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- 5. FINANCIAL TABLES (High Integrity)
create table public.financial_transactions (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    date date not null default current_date,
    description text not null,
    amount decimal(15,2) not null check (amount <> 0),
    type transaction_type not null,
    category text not null,
    created_by uuid references auth.users,
    created_at timestamptz default now()
);

create table public.invoices (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    customer_id uuid references public.customers on delete set null,
    invoice_number text not null,
    type text not null default 'Invoice', -- Invoice, Receipt, Estimate, CreditMemo
    status invoice_status not null default 'Pending',
    date date not null default current_date,
    due_date date,
    subtotal decimal(15,2) default 0,
    tax decimal(15,2) default 0,
    total decimal(15,2) default 0,
    vat_included boolean default true,
    notes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(business_id, invoice_number)
);

create table public.invoice_items (
    id uuid primary key default uuid_generate_v4(),
    invoice_id uuid references public.invoices on delete cascade,
    catalog_item_id uuid references public.catalog_items on delete set null,
    item_name text not null,
    quantity integer not null check (quantity > 0),
    unit_price decimal(15,2) not null,
    total_price decimal(15,2) not null
);

create table public.payments (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    invoice_id uuid references public.invoices on delete set null,
    customer_id uuid references public.customers on delete set null,
    amount decimal(15,2) not null check (amount > 0),
    payment_method text not null,
    reference text,
    created_at timestamptz default now()
);

create table public.sales (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    customer_id uuid references public.customers on delete set null,
    total_amount decimal(15,2) not null,
    payment_method text not null,
    created_at timestamptz default now()
);

create table public.sale_items (
    id uuid primary key default uuid_generate_v4(),
    sale_id uuid references public.sales on delete cascade,
    catalog_item_id uuid references public.catalog_items on delete set null,
    quantity integer not null,
    unit_price decimal(15,2) not null
);

-- 6. HR TABLES
create table public.employees (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    name text not null,
    email text,
    role text,
    department text,
    base_salary decimal(15,2) not null default 0,
    status text default 'Active',
    bank_name text,
    account_number text,
    created_at timestamptz default now()
);

create table public.attendance (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses on delete cascade,
    employee_id uuid references public.employees on delete cascade,
    check_in timestamptz not null,
    check_out timestamptz,
    status text default 'Present',
    created_at timestamptz default now()
);

-- 7. AUDIT LOGS
create table public.audit_logs (
    id uuid primary key default uuid_generate_v4(),
    business_id uuid references public.businesses,
    user_id uuid references auth.users,
    action text not null,
    table_name text,
    record_id uuid,
    details jsonb,
    created_at timestamptz default now()
);

-- 8. SECURITY DEFINERS (RLS Helpers)
create or replace function public.check_business_access(b_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.business_members 
    where business_id = b_id 
    and user_id = auth.uid()
    and status = 'Active'
  );
end;
$$ language plpgsql security definer;

-- 9. ATOMIC FINANCIAL PROCEDURES (RPCs)

-- A. Audit Helper
create or replace function public.record_audit(
    p_business_id uuid,
    p_action text,
    p_table text,
    p_record_id uuid,
    p_details jsonb
) returns void as $$
begin
    insert into public.audit_logs (business_id, user_id, action, table_name, record_id, details)
    values (p_business_id, auth.uid(), p_action, p_table, p_record_id, p_details);
end;
$$ language plpgsql security definer;

-- B. Atomic POS Checkout
create or replace function public.process_sale(
    p_business_id uuid,
    p_customer_id uuid,
    p_items jsonb,
    p_payment_method text,
    p_total_amount decimal
) returns uuid as $$
declare
    v_sale_id uuid;
    v_item jsonb;
    v_current_stock int;
begin
    -- 1. Security Check
    if not public.check_business_access(p_business_id) then
        raise exception 'Unauthorized access to this business context';
    end if;

    -- 2. Inventory Pre-Check & Adjustment
    for v_item in select * from jsonb_array_elements(p_items) loop
        select quantity into v_current_stock 
        from public.catalog_items 
        where id = (v_item->>'id')::uuid 
        and business_id = p_business_id 
        for update;

        if v_current_stock < (v_item->>'quantity')::int then
            raise exception 'Insufficient stock for item %', v_item->>'name';
        end if;

        update public.catalog_items 
        set quantity = quantity - (v_item->>'quantity')::int,
            updated_at = now()
        where id = (v_item->>'id')::uuid;
    end loop;

    -- 3. Record Sale
    insert into public.sales (business_id, customer_id, total_amount, payment_method)
    values (p_business_id, p_customer_id, p_total_amount, p_payment_method)
    returning id into v_sale_id;

    -- 4. Record Sale Items
    for v_item in select * from jsonb_array_elements(p_items) loop
        insert into public.sale_items (sale_id, catalog_item_id, quantity, unit_price)
        values (v_sale_id, (v_item->>'id')::uuid, (v_item->>'quantity')::int, (v_item->>'price')::decimal);
    end loop;

    -- 5. Record Financial Transaction (Income)
    insert into public.financial_transactions (business_id, description, amount, type, category, created_by)
    values (p_business_id, 'POS Sale: #' || v_sale_id, p_total_amount, 'Income', 'Sales', auth.uid());

    -- 6. Log Audit
    perform public.record_audit(p_business_id, 'POS_SALE', 'sales', v_sale_id, jsonb_build_object('amount', p_total_amount, 'method', p_payment_method));

    return v_sale_id;
end;
$$ language plpgsql security definer;

-- C. Atomic Invoicing
create or replace function public.create_invoice_atomic(
    p_business_id uuid,
    p_customer_id uuid,
    p_invoice_number text,
    p_type text,
    p_status invoice_status,
    p_date date,
    p_due_date date,
    p_subtotal decimal,
    p_tax decimal,
    p_total decimal,
    p_vat_included boolean,
    p_notes text,
    p_items jsonb
) returns uuid as $$
declare
    v_invoice_id uuid;
    v_item jsonb;
begin
    if not public.check_business_access(p_business_id) then
        raise exception 'Unauthorized';
    end if;

    insert into public.invoices (business_id, customer_id, invoice_number, type, status, date, due_date, subtotal, tax, total, vat_included, notes)
    values (p_business_id, p_customer_id, p_invoice_number, p_type, p_status, p_date, p_due_date, p_subtotal, p_tax, p_total, p_vat_included, p_notes)
    returning id into v_invoice_id;

    for v_item in select * from jsonb_array_elements(p_items) loop
        insert into public.invoice_items (invoice_id, catalog_item_id, item_name, quantity, unit_price, total_price)
        values (v_invoice_id, (v_item->>'catalog_item_id')::uuid, v_item->>'item_name', (v_item->>'quantity')::int, (v_item->>'unit_price')::decimal, (v_item->>'total_price')::decimal);
    end loop;

    return v_invoice_id;
end;
$$ language plpgsql security definer;

-- D. Atomic Payment Recording
create or replace function public.record_payment_atomic(
    p_business_id uuid,
    p_invoice_id uuid,
    p_customer_id uuid,
    p_amount decimal,
    p_payment_method text,
    p_reference text
) returns uuid as $$
declare
    v_payment_id uuid;
    v_item record;
begin
    if not public.check_business_access(p_business_id) then
        raise exception 'Unauthorized';
    end if;

    -- 1. Check if invoice exists and isn't already paid
    if p_invoice_id is not null then
        if exists (select 1 from public.invoices where id = p_invoice_id and status = 'Paid') then
            raise exception 'Invoice already settled';
        end if;

        -- 2. Update Invoice
        update public.invoices set status = 'Paid', updated_at = now() where id = p_invoice_id;

        -- 3. Decrement Inventory for product items on invoice
        for v_item in 
            select ii.catalog_item_id, ii.quantity 
            from public.invoice_items ii
            join public.catalog_items ci on ci.id = ii.catalog_item_id
            where ii.invoice_id = p_invoice_id and ci.type = 'Product'
        loop
            update public.catalog_items set quantity = quantity - v_item.quantity where id = v_item.catalog_item_id;
        end loop;
    end if;

    -- 4. Record Payment
    insert into public.payments (business_id, invoice_id, customer_id, amount, payment_method, reference)
    values (p_business_id, p_invoice_id, p_customer_id, p_amount, p_payment_method, p_reference)
    returning id into v_payment_id;

    -- 5. Record Ledger Entry
    insert into public.financial_transactions (business_id, description, amount, type, category, created_by)
    values (p_business_id, 'Payment Received: #' || coalesce(p_reference, v_payment_id::text), p_amount, 'Income', 'Payments', auth.uid());

    perform public.record_audit(p_business_id, 'PAYMENT_RECEIVED', 'payments', v_payment_id, jsonb_build_object('amount', p_amount));

    return v_payment_id;
end;
$$ language plpgsql security definer;

-- 10. INDEXES for Performance
create index idx_tx_business_date on public.financial_transactions(business_id, date);
create index idx_catalog_business_type on public.catalog_items(business_id, type);
create index idx_members_user on public.business_members(user_id);
create index idx_invoices_customer on public.invoices(customer_id);

-- 11. ROW LEVEL SECURITY (RLS) POLICIES
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.business_members enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.catalog_items enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;

-- Policies
create policy tenant_isolation_businesses on public.businesses for all using (id in (select business_id from public.business_members where user_id = auth.uid()));
create policy profile_self on public.profiles for all using (id = auth.uid());
create policy tenant_isolation_members on public.business_members for all using (business_id in (select business_id from public.business_members where user_id = auth.uid()));
create policy tenant_isolation_customers on public.customers for all using (public.check_business_access(business_id));
create policy tenant_isolation_suppliers on public.suppliers for all using (public.check_business_access(business_id));
create policy tenant_isolation_catalog on public.catalog_items for all using (public.check_business_access(business_id));
create policy tenant_isolation_tx on public.financial_transactions for all using (public.check_business_access(business_id));
create policy tenant_isolation_invoices on public.invoices for all using (public.check_business_access(business_id));
create policy tenant_isolation_invoice_items on public.invoice_items for all using (invoice_id in (select id from public.invoices where public.check_business_access(business_id)));
create policy tenant_isolation_payments on public.payments for all using (public.check_business_access(business_id));
create policy tenant_isolation_sales on public.sales for all using (public.check_business_access(business_id));
create policy tenant_isolation_sale_items on public.sale_items for all using (sale_id in (select id from public.sales where public.check_business_access(business_id)));
create policy tenant_isolation_employees on public.employees for all using (public.check_business_access(business_id));
create policy tenant_isolation_attendance on public.attendance for all using (public.check_business_access(business_id));
create policy tenant_isolation_audit on public.audit_logs for select using (public.check_business_access(business_id));
