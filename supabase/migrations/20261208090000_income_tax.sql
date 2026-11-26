-- Company income tax estimate (R4; Nigeria Tax Act 2025, effective 1 January 2026): a yearly estimate of companies
-- income tax and the development levy from the books, with every adjustment shown. An estimate only: nothing posts.
--
-- Owner decisions of 26 November 2026: a small company is one with turnover up to N50 million (the Act's text; the
-- June 2026 transition guidelines say N100 million) and fixed assets up to N250 million, and not a professional
-- services firm; it pays neither tax nor levy. Others pay 30% on total profits and the 4% development levy on
-- assessable profits. The figures are kept in one reviewed row; off until a tax professional reviews the estimate
-- (accounting.income_tax_switch), on for CACU's preview business.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.income_tax_switch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounting.income_tax_switch DEFAULT VALUES;

CREATE TABLE accounting.income_tax_rule (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 small_turnover numeric(15,2) NOT NULL CHECK (small_turnover > 0),
 small_fixed_assets numeric(15,2) NOT NULL CHECK (small_fixed_assets > 0),
 cit_rate numeric(5,4) NOT NULL CHECK (cit_rate > 0 AND cit_rate < 1),
 levy_rate numeric(5,4) NOT NULL CHECK (levy_rate >= 0 AND levy_rate < 1),
 source text NOT NULL,
 reviewed_at timestamptz
);
INSERT INTO accounting.income_tax_rule(small_turnover, small_fixed_assets, cit_rate, levy_rate, source)
VALUES (50000000, 250000000, 0.30, 0.04, 'Nigeria Tax Act 2025 as CACU reads it (small company turnover from the Act''s text); to be confirmed');

-- What the owner (or their accountant) tells CACU about a tax year: losses brought forward from before CACU, and
-- whether the business provides professional services (never a small company).
CREATE TABLE accounting.tax_year (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 year integer NOT NULL CHECK (year BETWEEN 2026 AND 2100),
 losses_brought_forward numeric(15,2) NOT NULL DEFAULT 0 CHECK (losses_brought_forward >= 0),
 professional_services boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, year)
);

-- Adjustments the books cannot know: expenses the law does not allow (fines, penalties, private spending) are added
-- back; income that is not taxable is deducted.
CREATE TABLE accounting.tax_adjustment (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 year integer NOT NULL CHECK (year BETWEEN 2026 AND 2100),
 direction text NOT NULL CHECK (direction IN ('add', 'deduct')),
 label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id)
);
CREATE INDEX tax_adjustment_year ON accounting.tax_adjustment (business_id, year);

ALTER TABLE accounting.tax_year ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_year FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_adjustment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.tax_year TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.tax_adjustment TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.income_tax_switch, accounting.income_tax_rule, accounting.tax_year, accounting.tax_adjustment FROM PUBLIC, anon, authenticated;
GRANT SELECT ON accounting.income_tax_switch, accounting.income_tax_rule TO cacu_runtime;
GRANT SELECT, INSERT, UPDATE ON accounting.tax_year TO cacu_runtime;
GRANT SELECT, INSERT, DELETE ON accounting.tax_adjustment TO cacu_runtime;
