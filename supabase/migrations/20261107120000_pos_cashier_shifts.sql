-- POS, part 4: cashier shifts (Doc 10 shifts, Doc 09 PR-22, Doc 11 /shifts), on the Oga and Chairman plans.
--  * a cashier opens a shift with a counted float; every sale and cash movement they make while it is open is tagged
--    to it in a cash ledger (accounting.till_shift_entry), so the shift's expected cash is the float plus that ledger;
--  * pay-ins and pay-outs need a reason and post as expenses (PR-17) or as transfers between the till and a bank
--    (PR-21);
--  * closing: the cashier counts the cash; any difference from the expected cash posts to Cash over and short (PR-22)
--    and is shown to the owner on Daily reconciliation. A shift still open after midnight business time is flagged.
SET LOCAL search_path = public, pg_catalog;

-- Shifts are an Oga and Chairman feature (Doc 10 "Shifts (Innovator, Empire)").
INSERT INTO platform.plan_entitlements(plan_code, key, value) VALUES
 ('BASE', 'module.shifts', 'false'), ('GROW', 'module.shifts', 'true'), ('TOP', 'module.shifts', 'true')
ON CONFLICT (plan_code, key) DO NOTHING;

-- Whether the business's plan includes shifts, for the accounting runtime (which cannot read platform). Unbilled
-- businesses keep every feature until billing launches, as elsewhere.
CREATE FUNCTION accounting.shifts_allowed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT accounting.authorized(p_business_id)
    AND coalesce(platform.entitlement(p_business_id, 'module.shifts') = 'true'::jsonb, true);
$$;
REVOKE ALL ON FUNCTION accounting.shifts_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.shifts_allowed(uuid) TO cacu_runtime;

-- The owner's choice: when on, the till refuses sales from anyone without an open shift.
ALTER TABLE accounting.sales_policy ADD COLUMN IF NOT EXISTS require_shift boolean NOT NULL DEFAULT false;

-- id is the opening request key.
CREATE TABLE accounting.till_shift (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 opened_by uuid NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT now(),
 opened_on date NOT NULL,
 opening_float numeric(15,2) NOT NULL CHECK (opening_float >= 0),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
 closed_by uuid, closed_at timestamptz, closed_on date,
 expected_cash numeric(15,2),
 counted_cash numeric(15,2) CHECK (counted_cash >= 0),
 variance numeric(15,2),
 close_note text CHECK (length(close_note) <= 500),
 posting jsonb,
 PRIMARY KEY (business_id, id),
 CHECK ((status = 'open') = (closed_by IS NULL AND closed_at IS NULL AND closed_on IS NULL)),
 CHECK (status = 'open' OR (expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND variance = counted_cash - expected_cash))
);
-- One open shift per person.
CREATE UNIQUE INDEX till_shift_one_open ON accounting.till_shift (business_id, opened_by) WHERE status = 'open';
CREATE INDEX till_shift_closed_on ON accounting.till_shift (business_id, closed_on);

-- Closed once: only the closing columns change, and only from open.
CREATE FUNCTION accounting.till_shift_closed_once() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'open' OR NEW.status <> 'closed' THEN
  RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.opened_by, NEW.opened_at, NEW.opened_on, NEW.opening_float)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.opened_by, OLD.opened_at, OLD.opened_on, OLD.opening_float) THEN
  RAISE EXCEPTION 'SHIFT_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER till_shift_closed_once BEFORE UPDATE ON accounting.till_shift
 FOR EACH ROW EXECUTE FUNCTION accounting.till_shift_closed_once();

-- Pay-ins and pay-outs. id is the request key. A pay-out goes to an expense account or a bank account; a pay-in comes
-- from a bank account.
CREATE TABLE accounting.till_movement (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 shift_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('pay_in', 'pay_out')),
 destination text NOT NULL CHECK (destination IN ('expense', 'bank')),
 account_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 posting jsonb NOT NULL,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (business_id, shift_id) REFERENCES accounting.till_shift(business_id, id),
 CHECK (kind = 'pay_out' OR destination = 'bank')
);
CREATE INDEX till_movement_shift ON accounting.till_movement (business_id, shift_id);

-- The shift's cash ledger: cash into the till is positive, cash out negative. Append-only.
CREATE TABLE accounting.till_shift_entry (
 business_id uuid NOT NULL,
 shift_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('sale', 'refund', 'pay_in', 'pay_out', 'sale_reversed')),
 source_id uuid NOT NULL,
 cash numeric(15,2) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, shift_id, kind, source_id),
 FOREIGN KEY (business_id, shift_id) REFERENCES accounting.till_shift(business_id, id),
 CHECK (CASE kind WHEN 'sale' THEN cash >= 0 WHEN 'pay_in' THEN cash > 0 ELSE cash < 0 END)
);
CREATE INDEX till_shift_entry_source ON accounting.till_shift_entry (business_id, source_id);

-- Nothing is added to a shift once it is closed.
CREATE FUNCTION accounting.till_shift_entry_open() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM accounting.till_shift WHERE business_id = NEW.business_id AND id = NEW.shift_id AND status = 'open') THEN
  RAISE EXCEPTION 'SHIFT_CLOSED' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER till_shift_entry_open BEFORE INSERT ON accounting.till_shift_entry
 FOR EACH ROW EXECUTE FUNCTION accounting.till_shift_entry_open();
CREATE TRIGGER till_movement_open BEFORE INSERT ON accounting.till_movement
 FOR EACH ROW EXECUTE FUNCTION accounting.till_shift_entry_open();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['till_shift', 'till_movement', 'till_shift_entry'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.till_shift, accounting.till_movement, accounting.till_shift_entry TO cacu_runtime;
GRANT UPDATE (status, closed_by, closed_at, closed_on, expected_cash, counted_cash, variance, close_note, posting) ON accounting.till_shift TO cacu_runtime;
