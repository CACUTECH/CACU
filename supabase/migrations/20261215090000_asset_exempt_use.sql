-- Capital allowances on an asset also used to earn income that is not taxable (R4; CACU's reading of the Nigeria Tax
-- Act 2025, to be confirmed by a tax professional with the rest of capital allowances, which stay off until then).
-- Such an asset claims only the taxable share of its allowance, unless non-taxable income is under 10% of the year's
-- total income. Off for every asset unless the owner marks it.
SET LOCAL search_path = accounting, public, pg_catalog;

ALTER TABLE accounting.asset_tax ADD COLUMN earns_exempt boolean NOT NULL DEFAULT false;
