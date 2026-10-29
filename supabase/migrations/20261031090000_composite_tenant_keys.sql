-- Doc 07 M-05 / DB-003, Doc 08 GAP-04 / SEC-002, Doc 19 TEST-002: a tenant row may reference only rows of its
-- own business. Single-column foreign keys are replaced by (column, business_id) keys to (id, business_id).
-- Referential actions follow DB-004: financial documents, journals and employee records block deletion of what
-- they reference instead of cascading or blanking it. Appointments and jobs keep clearing a deleted customer.
-- Stops with a report, changing nothing, if any existing row already references another business.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE tenant_refs(child text, col text, parent text, on_delete text) ON COMMIT DROP;
INSERT INTO tenant_refs VALUES
 ('appointments', 'customer_id', 'customers', 'SET NULL (customer_id)'),
 ('jobs', 'customer_id', 'customers', 'SET NULL (customer_id)'),
 ('invoices', 'customer_id', 'customers', 'NO ACTION'),
 ('transactions', 'customer_id', 'customers', 'NO ACTION'),
 ('payments', 'customer_id', 'customers', 'NO ACTION'),
 ('payments', 'invoice_id', 'invoices', 'NO ACTION'),
 ('payments', 'transaction_id', 'transactions', 'NO ACTION'),
 ('payment_events', 'payment_id', 'payments', 'NO ACTION'),
 ('payment_status_history', 'payment_id', 'payments', 'NO ACTION'),
 ('invoice_items', 'invoice_id', 'invoices', 'NO ACTION'),
 ('invoice_items', 'catalog_item_id', 'catalog_items', 'NO ACTION'),
 ('transaction_items', 'transaction_id', 'transactions', 'NO ACTION'),
 ('transaction_items', 'catalog_item_id', 'catalog_items', 'NO ACTION'),
 ('catalog_items', 'supplier_id', 'suppliers', 'NO ACTION'),
 ('journal_lines', 'journal_entry_id', 'journal_entries', 'NO ACTION'),
 ('journal_lines', 'account_id', 'accounts', 'RESTRICT'),
 ('attendance', 'employee_id', 'employees', 'NO ACTION'),
 ('hr_payslips', 'employee_id', 'employees', 'NO ACTION'),
 ('payslips', 'employee_id', 'employees', 'RESTRICT'),
 ('payslips', 'payroll_run_id', 'payroll_runs', 'CASCADE');

-- A null business_id would let a composite key pass unchecked. These tables are empty in production.
ALTER TABLE public.attendance ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.payment_events ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.suppliers ALTER COLUMN business_id SET NOT NULL;

DO $$
DECLARE r record; bad bigint; report text := ''; drops text;
BEGIN
 FOR r IN SELECT * FROM pg_temp.tenant_refs LOOP
  EXECUTE format('SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT FROM public.%I p WHERE p.id = c.%I AND p.business_id = c.business_id)',
   r.child, r.col, r.parent, r.col) INTO bad;
  IF bad > 0 THEN report := report || format(' %s.%s: %s;', r.child, r.col, bad); END IF;
 END LOOP;
 IF report <> '' THEN RAISE EXCEPTION 'CROSS_TENANT_REFERENCES%', report USING HINT = 'Resolve each row with the business owner, then rerun.'; END IF;

 FOR r IN SELECT DISTINCT parent FROM pg_temp.tenant_refs LOOP
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = format('public.%I', r.parent)::regclass AND contype IN ('u', 'p')
                 AND conkey::int[] @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = format('public.%I', r.parent)::regclass AND attname = 'id'),
                                            (SELECT attnum FROM pg_attribute WHERE attrelid = format('public.%I', r.parent)::regclass AND attname = 'business_id')]::int[]
                 AND array_length(conkey, 1) = 2) THEN
   EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, business_id)', r.parent, r.parent || '_id_business_id_key');
  END IF;
 END LOOP;

 FOR r IN SELECT * FROM pg_temp.tenant_refs LOOP
  SELECT string_agg(format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.child, c.conname), '; ') INTO drops
   FROM pg_constraint c WHERE c.conrelid = format('public.%I', r.child)::regclass AND c.contype = 'f'
     AND c.confrelid = format('public.%I', r.parent)::regclass AND array_length(c.conkey, 1) = 1
     AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = r.col);
  IF drops IS NOT NULL THEN EXECUTE drops; END IF;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, business_id) REFERENCES public.%I (id, business_id) ON DELETE %s',
   r.child, r.child || '_' || r.col || '_business_id_fkey', r.col, r.parent, r.on_delete);
 END LOOP;
END $$;

-- Composite keys check on the child's columns; index them so parent deletes and joins stay cheap (DB-013).
CREATE INDEX IF NOT EXISTS invoices_business_customer_idx ON public.invoices (business_id, customer_id);
CREATE INDEX IF NOT EXISTS transactions_business_customer_idx ON public.transactions (business_id, customer_id);
CREATE INDEX IF NOT EXISTS payments_business_invoice_idx ON public.payments (business_id, invoice_id);
CREATE INDEX IF NOT EXISTS invoice_items_business_invoice_idx ON public.invoice_items (business_id, invoice_id);
CREATE INDEX IF NOT EXISTS transaction_items_business_transaction_idx ON public.transaction_items (business_id, transaction_id);
CREATE INDEX IF NOT EXISTS journal_lines_business_entry_idx ON public.journal_lines (business_id, journal_entry_id);
COMMIT;
