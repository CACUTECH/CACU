-- VAT, part 2a (Doc 09 PR-32 and accounts 1310, 2200; Doc 12 SCR-24 taxes; Doc 16 tax rules with effective dates;
-- Doc 10 E14 R3 part 2). Owner decisions of 17 November 2026:
--  * VAT is off unless the business says it is VAT-registered (Settings › Taxes), from a date it gives;
--  * then 7.5% standard; each item is standard, zero-rated or exempt; till prices include VAT; each invoice says
--    whether its prices include VAT;
--  * WHT deducted by customers is recorded too (account 1320), flagged as unreviewed (part 2c).
-- The settings, item VAT classes, the VAT accounts, the record each taxed document leaves for the VAT return
-- (output VAT on sales and invoices, 2a; input VAT on bills and expenses, 2b; taken back by refunds, credit notes and
-- reversals, 2c), and WHT deducted by customers (2c).
SET LOCAL search_path = accounting, public, pg_catalog;

-- The rates, with the date each applies from, so a past document always shows the rate it was charged at.
CREATE TABLE accounting.vat_rate (
 vat_class text NOT NULL CHECK (vat_class IN ('standard', 'zero_rated', 'exempt')),
 rate numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate < 100),
 effective_from date NOT NULL,
 PRIMARY KEY (vat_class, effective_from)
);
INSERT INTO accounting.vat_rate VALUES ('standard', 7.5, '2020-02-01'), ('zero_rated', 0, '2020-02-01'), ('exempt', 0, '2020-02-01');
REVOKE ALL ON accounting.vat_rate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON accounting.vat_rate TO cacu_runtime;

-- Whether the business charges VAT, and from when.
CREATE TABLE accounting.vat_setting (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 registered boolean NOT NULL DEFAULT false,
 vat_number text CHECK (vat_number IS NULL OR vat_number ~ '^[0-9A-Za-z-]{6,20}$'),
 effective_from date,
 invoices_include_vat boolean NOT NULL DEFAULT false,
 -- Customers deduct withholding tax before paying (part 2c); turning it on adds the WHT credits account (1320).
 wht_enabled boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT registered OR (vat_number IS NOT NULL AND effective_from IS NOT NULL))
);

-- WHT deducted by customers (part 2c, Doc 09 PR-33): each deduction, with the customer's certificate number when it
-- arrives. Treatment to be confirmed by the accountant reviewer; shown as unreviewed.
CREATE TABLE accounting.wht_deduction (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 amount numeric(19,2) NOT NULL CHECK (amount > 0),
 entry_date date NOT NULL,
 certificate text CHECK (certificate IS NULL OR length(btrim(certificate)) BETWEEN 1 AND 60),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id)
);
CREATE INDEX wht_deduction_month ON accounting.wht_deduction (business_id, entry_date);

-- Each item's VAT class. An item without a row is standard-rated.
CREATE TABLE accounting.item_vat_class (
 business_id uuid NOT NULL,
 item_id uuid NOT NULL,
 vat_class text NOT NULL CHECK (vat_class IN ('standard', 'zero_rated', 'exempt')),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, item_id)  -- the API checks the item belongs to the business
);

-- What each taxed document charged or paid, for the VAT return. Written in the same transaction as its posting.
-- A refund, credit note or reversal is its own row with negative amounts, pointing at the document it takes back
-- (original_type, original_id). base is the value the lines were priced at: the gross where prices include VAT, the
-- net where VAT was added on top; it lets later credits know what is left to take back.
CREATE TABLE accounting.document_vat (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 source_type text NOT NULL,
 source_id uuid NOT NULL,
 direction text NOT NULL CHECK (direction IN ('output', 'input')),
 entry_date date NOT NULL,
 standard_net numeric(19,2) NOT NULL DEFAULT 0,
 zero_rated_net numeric(19,2) NOT NULL DEFAULT 0,
 exempt_net numeric(19,2) NOT NULL DEFAULT 0,
 vat numeric(19,2) NOT NULL,
 rate numeric(7,4) NOT NULL,
 base numeric(19,2) NOT NULL,
 inclusive boolean NOT NULL,
 original_type text,
 original_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, source_type, source_id),
 CHECK ((original_id IS NULL) = (original_type IS NULL)),
 -- A document charges or claims; a credit against it takes back, never more.
 CHECK (CASE WHEN original_id IS NULL THEN vat >= 0 AND base >= 0 ELSE vat <= 0 AND base <= 0 END)
);
CREATE INDEX document_vat_credits ON accounting.document_vat (business_id, original_type, original_id) WHERE original_id IS NOT NULL;
CREATE INDEX document_vat_month ON accounting.document_vat (business_id, direction, entry_date);

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['vat_setting', 'item_vat_class', 'document_vat', 'wht_deduction'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT, UPDATE ON accounting.vat_setting, accounting.item_vat_class TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.document_vat, accounting.wht_deduction TO cacu_runtime;
GRANT UPDATE (certificate) ON accounting.wht_deduction TO cacu_runtime;

-- The VAT accounts, added to a business's chart when it turns VAT on (Doc 09: 1310 input VAT, 2200 output VAT,
-- 1320 WHT credits).
DO $kinds$
BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step) VALUES
   ('vat_input', 'asset', 'CURRENT_ASSET', 'operating', 'vat_input', 1310, 1319, 1),
   ('wht_receivable', 'asset', 'CURRENT_ASSET', 'operating', 'wht_receivable', 1320, 1329, 1),
   ('vat_output', 'liability', 'CURRENT_LIABILITY', 'operating', 'vat_output', 2200, 2209, 1)
  ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;
