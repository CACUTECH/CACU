-- Corrections for fixed assets and payroll (R4 review, owner decision of 27 November 2026). These records are fixed
-- once made, so a mistake is corrected by a dated reversing journal that keeps the history, Owner only, with a reason:
--   * an asset entered in error is removed: its purchase (or bringing-in), its depreciation and any disposal are
--     reversed, and it leaves the register;
--   * a payroll payment or remittance recorded in error is reversed: what was paid is owed again.
-- Reversing a payroll posting itself is not offered: HR locks an approved run, so there would be nothing to redo.
SET LOCAL search_path = accounting, public, pg_catalog;

ALTER TABLE accounting.fixed_asset
 ADD COLUMN removed_on date,
 ADD COLUMN removal_reason text CHECK (removal_reason IS NULL OR char_length(btrim(removal_reason)) BETWEEN 5 AND 500),
 ADD COLUMN removed_by uuid,
 ADD CONSTRAINT fixed_asset_removed CHECK ((removed_on IS NULL) = (removal_reason IS NULL) AND (removed_on IS NULL) = (removed_by IS NULL));
GRANT UPDATE (removed_on, removal_reason, removed_by) ON accounting.fixed_asset TO cacu_runtime;

-- The register stays fixed: only a disposal, or a removal, is recorded on an asset, once each.
CREATE OR REPLACE FUNCTION accounting.fixed_asset_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE disposal text[] := ARRAY['disposed_on', 'disposal_proceeds', 'disposal_transaction_id', 'disposed_by'];
 removal text[] := ARRAY['removed_on', 'removal_reason', 'removed_by'];
BEGIN
 -- The table is checked on its own first: PL/pgSQL may evaluate a whole condition, and the run and charge tables have
 -- no disposal or removal columns.
 IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'fixed_asset' THEN
  IF (to_jsonb(OLD) ->> 'removed_on') IS NULL THEN
   IF (to_jsonb(OLD) ->> 'disposed_on') IS NULL AND (to_jsonb(NEW) ->> 'disposed_on') IS NOT NULL
      AND (to_jsonb(NEW) - disposal) = (to_jsonb(OLD) - disposal) THEN
    RETURN NEW;
   END IF;
   IF (to_jsonb(NEW) ->> 'removed_on') IS NOT NULL AND (to_jsonb(NEW) - removal) = (to_jsonb(OLD) - removal) THEN
    RETURN NEW;
   END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Fixed asset records are never changed: remove an asset entered in error on the Fixed Assets page instead' USING ERRCODE = '55000';
END $$;

-- A payroll payment or remittance reversed: kept beside the payment, which is never changed.
CREATE TABLE accounting.payroll_settlement_reversal (
 business_id uuid NOT NULL,
 settlement_id uuid NOT NULL,
 transaction_id integer NOT NULL,
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
 reversed_by uuid NOT NULL,
 reversed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, settlement_id),
 FOREIGN KEY (business_id, settlement_id) REFERENCES accounting.payroll_settlement(business_id, id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id)
);
CREATE TRIGGER payroll_settlement_reversal_fixed BEFORE UPDATE OR DELETE ON accounting.payroll_settlement_reversal
 FOR EACH ROW EXECUTE FUNCTION accounting.payroll_fixed();
ALTER TABLE accounting.payroll_settlement_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.payroll_settlement_reversal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.payroll_settlement_reversal TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.payroll_settlement_reversal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON accounting.payroll_settlement_reversal TO cacu_runtime;

-- The messages say what can actually be done.
CREATE OR REPLACE FUNCTION accounting.payroll_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Posted payroll is never changed: reverse a payment recorded in error instead' USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION accounting.payroll_run_posted_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS (SELECT FROM accounting.payroll_posting p WHERE p.business_id = OLD.business_id AND p.run_id = OLD.id) THEN
  RAISE EXCEPTION 'PAYROLL_RUN_POSTED' USING ERRCODE = '55000', HINT = 'This payroll is in the books and cannot be cancelled. Correct it with a journal, or in next month''s payroll.';
 END IF;
 RETURN NEW;
END $$;
