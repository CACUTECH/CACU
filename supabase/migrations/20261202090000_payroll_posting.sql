-- Payroll to the books (Doc 03 FR-203; Doc 10 E21, R4): an approved payroll run is posted to the ledger by a separate,
-- deliberate step, then paying staff and remitting PAYE, pension, NHF and NHIS are recorded against it.
--
-- Off until the R4 release gate: payroll posting fixtures must be validated by a professional, with statutory sign-off,
-- before any business can post. CACU's switch, accounting.payroll_switch, starts off; turning it on is a reviewed
-- production change.
--
-- The journal for a run (Doc 09 payroll pattern):
--   Dr Salaries and wages (gross pay)            Cr Salaries payable (net pay owed to staff)
--   Dr Employer pension contributions            Cr PAYE payable, Pension payable (employee + employer), NHF payable,
--                                                   NHIS payable
-- Paying staff debits Salaries payable; each remittance debits its liability; both credit the till or a bank.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.payroll_switch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounting.payroll_switch DEFAULT VALUES;

-- One posting per run, fixed once made.
CREATE TABLE accounting.payroll_posting (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 run_id uuid NOT NULL,
 period date NOT NULL,
 entry_date date NOT NULL,
 totals jsonb NOT NULL CHECK (jsonb_typeof(totals) = 'object'),
 transaction_id integer NOT NULL,
 posted_by uuid NOT NULL,
 posted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, run_id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id)
);

-- Each payment of net pay and each remittance, against one posted run.
CREATE TABLE accounting.payroll_settlement (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 run_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('net_pay', 'paye', 'pension', 'nhf', 'nhis')),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 entry_date date NOT NULL,
 paid_from uuid NOT NULL,
 reference text CHECK (reference IS NULL OR length(reference) <= 120),
 transaction_id integer NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 FOREIGN KEY (business_id, run_id) REFERENCES accounting.payroll_posting(business_id, run_id)
);
CREATE INDEX payroll_settlement_run ON accounting.payroll_settlement (business_id, run_id, kind);

CREATE FUNCTION accounting.payroll_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Posted payroll is never changed: reverse it with a journal instead' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER payroll_posting_fixed BEFORE UPDATE OR DELETE ON accounting.payroll_posting FOR EACH ROW EXECUTE FUNCTION accounting.payroll_fixed();
CREATE TRIGGER payroll_settlement_fixed BEFORE UPDATE OR DELETE ON accounting.payroll_settlement FOR EACH ROW EXECUTE FUNCTION accounting.payroll_fixed();

ALTER TABLE accounting.payroll_posting ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.payroll_posting FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.payroll_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.payroll_settlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.payroll_posting TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.payroll_settlement TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.payroll_switch, accounting.payroll_posting, accounting.payroll_settlement FROM PUBLIC, anon, authenticated;
GRANT SELECT ON accounting.payroll_switch TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.payroll_posting, accounting.payroll_settlement TO cacu_runtime;

-- The payroll accounts, added to a business's chart the first time it posts payroll. Salaries and wages (6000) comes
-- with the default chart; a business without it gets one from the payroll_salaries kind.
DO $kinds$
BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step) VALUES
   ('salaries_payable', 'liability', 'CURRENT_LIABILITY', 'operating', 'salaries_payable', 2300, 2309, 1),
   ('paye_payable', 'liability', 'CURRENT_LIABILITY', 'operating', 'paye_payable', 2310, 2319, 1),
   ('pension_payable', 'liability', 'CURRENT_LIABILITY', 'operating', 'pension_payable', 2320, 2329, 1),
   ('nhf_payable', 'liability', 'CURRENT_LIABILITY', 'operating', 'nhf_payable', 2330, 2339, 1),
   ('nhis_payable', 'liability', 'CURRENT_LIABILITY', 'operating', 'nhis_payable', 2340, 2349, 1),
   ('payroll_salaries', 'expense', 'OPERATING_EXPENSE', 'operating', 'payroll_salaries', 6010, 6019, 1),
   ('employer_pension', 'expense', 'OPERATING_EXPENSE', 'operating', 'employer_pension', 6020, 6029, 1)
  ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;

-- An approved run's totals, for the accounting API, which cannot read the HR tables (they hold salaries). A member
-- of that business only; the API also requires payroll.approve. Null for anything else.
CREATE FUNCTION accounting.payroll_run(p_business_id uuid, p_run_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT accounting.authorized(p_business_id) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('id', r.id, 'period', r.period, 'status', r.status, 'approved_at', r.approved_at, 'employee_count', r.employee_count,
   'gross_total', r.gross_total, 'paye_total', r.paye_total, 'pension_employee_total', r.pension_employee_total,
   'pension_employer_total', r.pension_employer_total, 'nhf_total', r.nhf_total, 'nhis_total', r.nhis_total, 'net_total', r.net_total)
 INTO result FROM public.hr_payroll_runs r WHERE r.business_id = p_business_id AND r.id = p_run_id;
 RETURN result;
END $$;

-- The approved runs of a business, newest first, for the payroll books screen.
CREATE FUNCTION accounting.payroll_runs(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT accounting.authorized(p_business_id) THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(accounting.payroll_run(p_business_id, r.id) ORDER BY r.period DESC), '[]'::jsonb) INTO result
 FROM (SELECT id, period FROM public.hr_payroll_runs WHERE business_id = p_business_id AND status = 'approved' ORDER BY period DESC LIMIT 24) r;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION accounting.payroll_run(uuid, uuid), accounting.payroll_runs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.payroll_run(uuid, uuid), accounting.payroll_runs(uuid) TO cacu_runtime;

-- A run that is in the books cannot be cancelled in HR: its journal would no longer match anything.
CREATE FUNCTION accounting.payroll_run_posted_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS (SELECT FROM accounting.payroll_posting p WHERE p.business_id = OLD.business_id AND p.run_id = OLD.id) THEN
  RAISE EXCEPTION 'PAYROLL_RUN_POSTED' USING ERRCODE = '55000', HINT = 'This payroll is in the books. Reverse its journal instead of cancelling it.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION accounting.payroll_run_posted_guard() FROM PUBLIC, anon, authenticated;
DO $guard$
BEGIN
 IF to_regclass('public.hr_payroll_runs') IS NOT NULL THEN
  CREATE TRIGGER payroll_run_posted_guard BEFORE UPDATE ON public.hr_payroll_runs FOR EACH ROW EXECUTE FUNCTION accounting.payroll_run_posted_guard();
 END IF;
END $guard$;
