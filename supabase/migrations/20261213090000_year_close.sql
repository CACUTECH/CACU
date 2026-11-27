-- Year-end close (R4; owner decision of 27 November 2026). Once every month of a financial year is closed, the Owner
-- closes the year: it is locked (none of its months can be reopened until the year is reopened, by the Owner with a
-- reason), and the statement of financial position shows the profit of closed years as retained earnings and only
-- the open year's as profit for the year. Nothing posts: every report keeps reconciling with the ledger. Years end on
-- the business's year-end month (accounting.tax_profile; 31 December unless set), and close in order.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.year_close (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
 start_date date NOT NULL,
 end_date date NOT NULL CHECK (end_date > start_date),
 profit numeric(15,2) NOT NULL,
 closed_by uuid NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 reopened_at timestamptz,
 reopen_reason text CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 5 AND 500),
 reopened_by uuid,
 PRIMARY KEY (business_id, id),
 CHECK ((reopened_at IS NULL) = (reopen_reason IS NULL) AND (reopened_at IS NULL) = (reopened_by IS NULL))
);
CREATE UNIQUE INDEX year_close_live ON accounting.year_close (business_id, year) WHERE reopened_at IS NULL;

-- Fixed once made; only a reopening is recorded, once.
CREATE FUNCTION accounting.year_close_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE reopening text[] := ARRAY['reopened_at', 'reopen_reason', 'reopened_by'];
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.reopened_at IS NULL AND NEW.reopened_at IS NOT NULL
    AND (to_jsonb(NEW) - reopening) = (to_jsonb(OLD) - reopening) THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'A closed year is never changed: reopen it instead' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER year_close_fixed BEFORE UPDATE OR DELETE ON accounting.year_close FOR EACH ROW EXECUTE FUNCTION accounting.year_close_fixed();

ALTER TABLE accounting.year_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.year_close FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.year_close TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.year_close FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON accounting.year_close TO cacu_runtime;
GRANT UPDATE (reopened_at, reopen_reason, reopened_by) ON accounting.year_close TO cacu_runtime;
