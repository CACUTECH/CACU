-- Stock counts (Doc 18 R3 "E09 counts"; Doc 09 PR-20 and month-end step 4; Doc 10 E09). Owner decision of 18 November
-- 2026: anyone with stock permission enters counted quantities; an Owner or Admin approves the whole count once, which
-- posts every difference to Inventory adjustments and write-offs; the person who submitted the count cannot approve it.
-- A count covers one outlet (or the whole business when it has no outlets). Expected quantities are taken when the
-- count is submitted; uncounted items are left as they are. Approval posts each difference as a stock adjustment
-- through the existing workflow (cacu/accounting/counts.py), so stock, valuation and the ledger move together.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.stock_count (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 location_id uuid,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'submitted', 'approved', 'rejected')),
 started_by uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 submitted_by uuid,
 submitted_at timestamptz,
 decided_by uuid,
 decided_at timestamptz,
 decided_on date,
 note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 3 AND 500),
 PRIMARY KEY (business_id, id),
 CHECK (status = 'counting' OR submitted_by IS NOT NULL),
 CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_on IS NOT NULL)),
 CHECK (decided_by IS NULL OR decided_by <> submitted_by)
);
-- One open count per outlet (and one for a business without outlets).
CREATE UNIQUE INDEX stock_count_one_open ON accounting.stock_count (business_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
 WHERE status IN ('counting', 'submitted');

CREATE TABLE accounting.stock_count_line (
 business_id uuid NOT NULL,
 count_id uuid NOT NULL,
 item_id uuid NOT NULL,
 expected integer NOT NULL,
 counted integer CHECK (counted IS NULL OR counted >= 0),
 adjustment_id uuid,
 PRIMARY KEY (business_id, count_id, item_id),
 FOREIGN KEY (business_id, count_id) REFERENCES accounting.stock_count(business_id, id)
);

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['stock_count', 'stock_count_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT ON accounting.stock_count, accounting.stock_count_line TO cacu_runtime;
GRANT UPDATE (status, submitted_by, submitted_at, decided_by, decided_at, decided_on, note) ON accounting.stock_count TO cacu_runtime;
GRANT UPDATE (expected, counted, adjustment_id) ON accounting.stock_count_line TO cacu_runtime;
