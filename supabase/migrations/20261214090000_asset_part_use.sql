-- Part business use of a fixed asset for capital allowances (R4; CACU's reading of the Nigeria Tax Act 2025, to be
-- confirmed by a tax professional with the rest of capital allowances, which stay off until then). An asset also used
-- privately (a car the owner drives home) claims only the business share of each year's allowance and of a balancing
-- charge or allowance; the tax written-down value still falls by the full allowance. 100% unless the owner says less.
SET LOCAL search_path = accounting, public, pg_catalog;

ALTER TABLE accounting.asset_tax ADD COLUMN business_use numeric(5,2) NOT NULL DEFAULT 100
 CONSTRAINT asset_tax_business_use CHECK (business_use > 0 AND business_use <= 100);
