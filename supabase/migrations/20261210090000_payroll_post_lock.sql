-- Payroll to the books (FR-203): posting a run locks its HR row first, so a cancellation in HR at the same moment
-- either waits for the posting (and is then refused by payroll_run_posted_guard) or wins (and the posting then sees
-- the run is no longer approved). Returns the run's status after the lock; null when there is no such run.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE FUNCTION accounting.payroll_run_lock(p_business_id uuid, p_run_id uuid) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result text;
BEGIN
 IF NOT accounting.authorized(p_business_id) THEN RETURN NULL; END IF;
 SELECT r.status INTO result FROM public.hr_payroll_runs r WHERE r.business_id = p_business_id AND r.id = p_run_id FOR SHARE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION accounting.payroll_run_lock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.payroll_run_lock(uuid, uuid) TO cacu_runtime;
