-- Budgets and budget against actual (Doc 03 FR-137, FR-145; Doc 11 R3 CRUD /budgets, GET /reports/budget-vs-actual;
-- Doc 12 SCR-18; Doc 10 E14 R3 part 3). One budget per financial year: an amount for each income and expense account
-- in each month. The accounting API checks the accounts and works out the actual figures from the ledger.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.budget (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, fiscal_year)
);

CREATE TABLE accounting.budget_line (
 business_id uuid NOT NULL,
 fiscal_year integer NOT NULL,
 account_id uuid NOT NULL,
 month date NOT NULL CHECK (month = date_trunc('month', month)::date),
 amount numeric(19,2) NOT NULL CHECK (amount >= 0),
 PRIMARY KEY (business_id, fiscal_year, account_id, month),
 FOREIGN KEY (business_id, fiscal_year) REFERENCES accounting.budget(business_id, fiscal_year) ON DELETE CASCADE
);

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['budget', 'budget_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT, UPDATE ON accounting.budget TO cacu_runtime;
GRANT SELECT, INSERT, DELETE ON accounting.budget_line TO cacu_runtime;
