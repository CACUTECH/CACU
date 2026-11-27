-- Income tax in the books (R4; owner decision of 27 November 2026). Once a year's estimate is final, the Owner posts
-- it, dated the last day of the tax year:
--   Dr Income tax expense (companies income tax + development levy)   Cr Income tax payable (what is left to pay)
--                                                                       Cr WHT credits (withholding tax used against it)
-- and payments to the tax office are recorded against it from the till or a bank (cash flow: income taxes paid). A
-- posting with no live payments, and any payment, can be reversed by the Owner with a reason; the reversal is its own
-- dated journal and the original is kept. Behind the income tax switch until a tax professional reviews the estimate.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.tax_accrual (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 year integer NOT NULL CHECK (year BETWEEN 2026 AND 2100),
 entry_date date NOT NULL,
 companies_income_tax numeric(15,2) NOT NULL CHECK (companies_income_tax >= 0),
 development_levy numeric(15,2) NOT NULL CHECK (development_levy >= 0),
 wht_used numeric(15,2) NOT NULL CHECK (wht_used >= 0 AND wht_used <= companies_income_tax),
 payable numeric(15,2) NOT NULL CHECK (payable = companies_income_tax + development_levy - wht_used),
 estimate jsonb NOT NULL,
 transaction_id integer NOT NULL,
 posted_by uuid NOT NULL,
 posted_at timestamptz NOT NULL DEFAULT now(),
 reversed_at timestamptz,
 reversal_reason text CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 5 AND 500),
 reversal_transaction_id integer,
 reversed_by uuid,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 FOREIGN KEY (reversal_transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL) AND (reversed_at IS NULL) = (reversal_transaction_id IS NULL) AND (reversed_at IS NULL) = (reversed_by IS NULL)),
 CHECK (companies_income_tax + development_levy > 0)
);
CREATE UNIQUE INDEX tax_accrual_live ON accounting.tax_accrual (business_id, year) WHERE reversed_at IS NULL;

CREATE TABLE accounting.tax_payment (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 accrual_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 entry_date date NOT NULL,
 paid_from uuid NOT NULL,
 reference text CHECK (reference IS NULL OR char_length(reference) <= 120),
 transaction_id integer NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 reversed_at timestamptz,
 reversal_reason text CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 5 AND 500),
 reversal_transaction_id integer,
 reversed_by uuid,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (business_id, accrual_id) REFERENCES accounting.tax_accrual(business_id, id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 FOREIGN KEY (reversal_transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL) AND (reversed_at IS NULL) = (reversal_transaction_id IS NULL) AND (reversed_at IS NULL) = (reversed_by IS NULL))
);

-- Fixed once made; only a reversal is recorded, once.
CREATE FUNCTION accounting.tax_record_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE reversal text[] := ARRAY['reversed_at', 'reversal_reason', 'reversal_transaction_id', 'reversed_by'];
BEGIN
 IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> 'reversed_at') IS NULL AND (to_jsonb(NEW) ->> 'reversed_at') IS NOT NULL
    AND (to_jsonb(NEW) - reversal) = (to_jsonb(OLD) - reversal) THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Income tax in the books is never changed: reverse it instead' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER tax_accrual_fixed BEFORE UPDATE OR DELETE ON accounting.tax_accrual FOR EACH ROW EXECUTE FUNCTION accounting.tax_record_fixed();
CREATE TRIGGER tax_payment_fixed BEFORE UPDATE OR DELETE ON accounting.tax_payment FOR EACH ROW EXECUTE FUNCTION accounting.tax_record_fixed();

ALTER TABLE accounting.tax_accrual ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_accrual FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_payment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.tax_accrual TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.tax_payment TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.tax_accrual, accounting.tax_payment FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON accounting.tax_accrual, accounting.tax_payment TO cacu_runtime;
GRANT UPDATE (reversed_at, reversal_reason, reversal_transaction_id, reversed_by) ON accounting.tax_accrual, accounting.tax_payment TO cacu_runtime;

-- Income tax payable carries the income_tax purpose, so paying it shows as income taxes paid in the cash flow.
DO $kinds$
BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step) VALUES
   ('income_tax', 'liability', 'CURRENT_LIABILITY', 'operating', 'income_tax', 2350, 2359, 1),
   ('income_tax_expense', 'expense', 'OTHER_EXPENSE', 'operating', 'income_tax_expense', 7900, 7909, 1)
  ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;
