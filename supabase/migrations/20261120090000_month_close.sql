-- Month close and reopen (Doc 09 "Periods, close, reconciliation and controls"; Doc 03 FR-135; Doc 07 period lock;
-- Doc 11 R3 POST /periods/{month}/close and /reopen; Doc 10 E14 R3 part 1). Owner decisions of 17 November 2026:
--  * months are the posting periods; a closed month takes no posting, by any route;
--  * closing is refused while the trial balance does not balance or receivables, payables or stock differ from their
--    control accounts; the other checklist steps are warnings the closer ticks or explains, kept with the close;
--  * closing needs ledger.post and ledger.approve; reopening is Owner only, with a reason, and is recorded.
-- Months close in order from the month the books started, and only after they have ended; only the latest closed
-- month can be reopened. The checks themselves run in the accounting API (cacu/accounting/periods.py).
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.period_close (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 month date NOT NULL CHECK (month = date_trunc('month', month)::date),
 status text NOT NULL CHECK (status IN ('closed', 'reopened')),
 closed_by uuid NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 checklist jsonb NOT NULL,
 reopened_by uuid,
 reopened_at timestamptz,
 reopen_reason text CHECK (reopen_reason IS NULL OR length(btrim(reopen_reason)) BETWEEN 5 AND 500),
 PRIMARY KEY (business_id, month),
 CHECK (status <> 'reopened' OR (reopened_by IS NOT NULL AND reopened_at IS NOT NULL AND reopen_reason IS NOT NULL))
);
ALTER TABLE accounting.period_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.period_close FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.period_close TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.period_close TO cacu_runtime;
GRANT UPDATE (status, closed_by, closed_at, checklist, reopened_by, reopened_at, reopen_reason) ON accounting.period_close TO cacu_runtime;

-- Whether a business's month is closed. Used by the ledger guard below and by the API's own checks.
CREATE FUNCTION accounting.month_closed(p_business_id uuid, p_day date) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT FROM accounting.period_close
  WHERE business_id = p_business_id AND month = date_trunc('month', p_day)::date AND status = 'closed');
$$;
REVOKE ALL ON FUNCTION accounting.month_closed(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.month_closed(uuid, date) TO cacu_runtime;

-- Nothing posts into a closed month: the ledger refuses the line itself, whichever route wrote it.
CREATE FUNCTION accounting.ledger_month_open() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF accounting.month_closed(NEW.business_id, NEW.transaction_date::date) THEN
  RAISE EXCEPTION 'ACCOUNTING_MONTH_CLOSED' USING ERRCODE = '23514',
   HINT = 'This month is closed. Date the entry in an open month, or ask the owner to reopen the month.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION accounting.ledger_month_open() FROM PUBLIC;
CREATE TRIGGER ledger_month_open BEFORE INSERT ON accounting.ledger
 FOR EACH ROW EXECUTE FUNCTION accounting.ledger_month_open();
