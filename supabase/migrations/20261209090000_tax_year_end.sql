-- Tax year end (R4; Nigeria Tax Act 2025): a business whose accounts end in a month other than December uses its own
-- tax year for the capital allowances and the income tax estimate. Tax year Y is the twelve months ending on the last
-- day of that month in Y. Without a row, accounts end on 31 December. Set by an Owner or Admin.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.tax_profile (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 year_end_month smallint NOT NULL CHECK (year_end_month BETWEEN 1 AND 12),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE accounting.tax_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.tax_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.tax_profile TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.tax_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON accounting.tax_profile TO cacu_runtime;
