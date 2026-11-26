-- Capital allowances (R4; Nigeria Tax Act 2025, effective 1 January 2026): tax depreciation on fixed assets, kept apart
-- from book depreciation, for the company income tax computation. Nothing here posts to the ledger.
--
-- As CACU reads the Act (PwC Worldwide Tax Summaries, reviewed 29 May 2026; to be confirmed by a tax professional
-- before release):
--   * no initial allowance; an annual allowance, straight-line on the qualifying cost, at 10%, 20% or 25% by class;
--   * 1% of the cost stays as the tax written-down value until the asset is disposed of;
--   * an asset qualifies only where any VAT due on it was charged, or import duty paid where imported;
--   * on disposal, proceeds above the tax written-down value are taxable.
--
-- Off until that review (accounting.capital_allowance_switch); on for CACU's preview business. The rates are CACU's
-- default reading and are kept in one reviewed table.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.capital_allowance_switch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounting.capital_allowance_switch DEFAULT VALUES;

-- The Act's classes and rates (CACU-wide). reviewed_at stays null until a tax professional confirms them.
CREATE TABLE accounting.capital_allowance_rate (
 tax_class text PRIMARY KEY CHECK (tax_class ~ '^[a-z_]{2,40}$'),
 label text NOT NULL,
 rate numeric(5,4) NOT NULL CHECK (rate > 0 AND rate <= 1),
 act_class smallint NOT NULL CHECK (act_class IN (1, 2, 3)),
 reviewed_at timestamptz
);
INSERT INTO accounting.capital_allowance_rate(tax_class, label, rate, act_class) VALUES
 ('building', 'Building expenditure', 0.10, 1),
 ('mast', 'Mast expenditure', 0.10, 1),
 ('heavy_transport', 'Heavy transportation expenditure', 0.10, 1),
 ('intangible', 'Intangible assets expenditure', 0.10, 1),
 ('agricultural', 'Agricultural expenditure', 0.10, 1),
 ('plant', 'Plant expenditure', 0.20, 2),
 ('agricultural_equipment', 'Agricultural equipment expenditure', 0.20, 2),
 ('furniture', 'Furniture and fittings expenditure', 0.20, 2),
 ('mining', 'Mining expenditure', 0.20, 2),
 ('other_equipment', 'Other equipment expenditure', 0.20, 2),
 ('motor_vehicle', 'Motor vehicle expenditure', 0.25, 3),
 ('software', 'Software expenditure', 0.25, 3),
 ('other_capital', 'Other capital expenditure', 0.25, 3);

-- Each asset's tax treatment, set by an Owner or Admin. Without a row an asset takes its category's default class and
-- qualifies. claimed_before: allowances already given on an asset owned before CACU, under earlier tax law.
CREATE TABLE accounting.asset_tax (
 business_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 tax_class text NOT NULL REFERENCES accounting.capital_allowance_rate(tax_class),
 qualifies boolean NOT NULL DEFAULT true,
 claimed_before numeric(15,2) NOT NULL DEFAULT 0 CHECK (claimed_before >= 0),
 note text CHECK (note IS NULL OR char_length(note) <= 500),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, asset_id),
 FOREIGN KEY (business_id, asset_id) REFERENCES accounting.fixed_asset(business_id, id)
);

ALTER TABLE accounting.asset_tax ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.asset_tax FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.asset_tax TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.capital_allowance_switch, accounting.capital_allowance_rate, accounting.asset_tax FROM PUBLIC, anon, authenticated;
GRANT SELECT ON accounting.capital_allowance_switch, accounting.capital_allowance_rate TO cacu_runtime;
GRANT SELECT, INSERT, UPDATE ON accounting.asset_tax TO cacu_runtime;
