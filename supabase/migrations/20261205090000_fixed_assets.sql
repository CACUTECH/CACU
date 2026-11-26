-- Fixed assets (Doc 10 R4; IAS 16): an asset register, monthly depreciation and disposals.
--
-- Owner decisions of 26 November 2026:
--   * an asset is bought paid (from the till or a bank), on credit (a supplier bill), or was already owned before the
--     books started in CACU (brought in with its depreciation to date, against retained earnings);
--   * depreciation is straight-line (cost less residual value over the useful life) or reducing balance (a yearly rate
--     on the carrying amount), charged monthly from the month the asset is bought or brought in, and not in the month
--     it is disposed of;
--   * an Owner or Admin posts each month's depreciation for every asset as one journal, months in order; month close
--     refuses a month that needs depreciation and has none posted.
--
-- Each category has its own cost account and accumulated depreciation account, added to the chart the first time it
-- is used. The register, its depreciation and its disposals are fixed once made: a mistake is reversed by a journal.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.fixed_asset (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
 category text NOT NULL CHECK (category IN ('buildings', 'vehicles', 'machinery', 'furniture', 'computers', 'other')),
 reference text CHECK (reference IS NULL OR char_length(reference) <= 60),
 acquired_on date NOT NULL,
 cost numeric(15,2) NOT NULL CHECK (cost > 0),
 residual numeric(15,2) NOT NULL DEFAULT 0 CHECK (residual >= 0 AND residual < cost),
 method text NOT NULL CHECK (method IN ('straight_line', 'reducing_balance')),
 useful_life_months integer CHECK (useful_life_months BETWEEN 1 AND 1200),
 annual_rate numeric(7,6) CHECK (annual_rate > 0 AND annual_rate <= 1),
 how text NOT NULL CHECK (how IN ('paid', 'credit', 'existing')),
 depreciate_from date NOT NULL CHECK (extract(day FROM depreciate_from) = 1),
 opening_accumulated numeric(15,2) NOT NULL DEFAULT 0 CHECK (opening_accumulated >= 0 AND opening_accumulated <= cost - residual),
 supplier_id uuid,
 transaction_id integer NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 disposed_on date,
 disposal_proceeds numeric(15,2) CHECK (disposal_proceeds >= 0),
 disposal_transaction_id integer,
 disposed_by uuid,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 FOREIGN KEY (disposal_transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 CHECK ((method = 'straight_line') = (useful_life_months IS NOT NULL) AND (method = 'reducing_balance') = (annual_rate IS NOT NULL)),
 CHECK (how = 'existing' OR opening_accumulated = 0),
 CHECK ((how = 'credit') = (supplier_id IS NOT NULL)),
 CHECK ((disposed_on IS NULL) = (disposal_proceeds IS NULL) AND (disposed_on IS NULL) = (disposal_transaction_id IS NULL)
        AND (disposed_on IS NULL) = (disposed_by IS NULL))
);
CREATE INDEX fixed_asset_active ON accounting.fixed_asset (business_id, depreciate_from) WHERE disposed_on IS NULL;

-- One run per month, even when nothing was left to charge; the journal is null then.
CREATE TABLE accounting.depreciation_run (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 entry_date date NOT NULL,
 total numeric(15,2) NOT NULL CHECK (total >= 0),
 transaction_id integer,
 posted_by uuid NOT NULL,
 posted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, month),
 FOREIGN KEY (transaction_id, business_id) REFERENCES accounting."transaction"(id, business_id),
 CHECK ((total > 0) = (transaction_id IS NOT NULL))
);

CREATE TABLE accounting.depreciation_charge (
 business_id uuid NOT NULL,
 month date NOT NULL,
 asset_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 PRIMARY KEY (business_id, month, asset_id),
 FOREIGN KEY (business_id, month) REFERENCES accounting.depreciation_run(business_id, month),
 FOREIGN KEY (business_id, asset_id) REFERENCES accounting.fixed_asset(business_id, id)
);

-- The register is fixed once made; only a disposal is recorded on an asset, once.
CREATE FUNCTION accounting.fixed_asset_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 -- The table is checked on its own first: PL/pgSQL may evaluate a whole condition, and the run and charge tables have
 -- no disposal columns.
 IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'fixed_asset' THEN
  IF (to_jsonb(OLD) ->> 'disposed_on') IS NULL AND (to_jsonb(NEW) ->> 'disposed_on') IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['disposed_on', 'disposal_proceeds', 'disposal_transaction_id', 'disposed_by'])
       = (to_jsonb(OLD) - ARRAY['disposed_on', 'disposal_proceeds', 'disposal_transaction_id', 'disposed_by']) THEN
   RETURN NEW;
  END IF;
 END IF;
 RAISE EXCEPTION 'Fixed asset records are never changed: reverse a mistake with a journal instead' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER fixed_asset_fixed BEFORE UPDATE OR DELETE ON accounting.fixed_asset FOR EACH ROW EXECUTE FUNCTION accounting.fixed_asset_fixed();
CREATE TRIGGER depreciation_run_fixed BEFORE UPDATE OR DELETE ON accounting.depreciation_run FOR EACH ROW EXECUTE FUNCTION accounting.fixed_asset_fixed();
CREATE TRIGGER depreciation_charge_fixed BEFORE UPDATE OR DELETE ON accounting.depreciation_charge FOR EACH ROW EXECUTE FUNCTION accounting.fixed_asset_fixed();

ALTER TABLE accounting.fixed_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.fixed_asset FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.depreciation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.depreciation_run FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.depreciation_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.depreciation_charge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.fixed_asset TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.depreciation_run TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.depreciation_charge TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.fixed_asset, accounting.depreciation_run, accounting.depreciation_charge FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON accounting.fixed_asset, accounting.depreciation_run, accounting.depreciation_charge TO cacu_runtime;
GRANT UPDATE (disposed_on, disposal_proceeds, disposal_transaction_id, disposed_by) ON accounting.fixed_asset TO cacu_runtime;

-- The accounts, added to a business's chart the first time a category is used: a cost account and an accumulated
-- depreciation account for each category, Depreciation (expense) and Gains and losses on disposal of assets.
-- Accumulated depreciation sits in the operating cash-flow section, so a month's depreciation, which moves no cash,
-- nets to nothing in the cash flow statement.
DO $kinds$
BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step) VALUES
   ('asset_buildings', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_buildings', 1500, 1509, 1),
   ('asset_vehicles', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_vehicles', 1510, 1519, 1),
   ('asset_machinery', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_machinery', 1520, 1529, 1),
   ('asset_furniture', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_furniture', 1530, 1539, 1),
   ('asset_computers', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_computers', 1540, 1549, 1),
   ('asset_other', 'asset', 'NON_CURRENT_ASSET', 'investing', 'asset_other', 1550, 1559, 1),
   ('accdep_buildings', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_buildings', 1600, 1609, 1),
   ('accdep_vehicles', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_vehicles', 1610, 1619, 1),
   ('accdep_machinery', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_machinery', 1620, 1629, 1),
   ('accdep_furniture', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_furniture', 1630, 1639, 1),
   ('accdep_computers', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_computers', 1640, 1649, 1),
   ('accdep_other', 'asset', 'CONTRA_ASSET', 'operating', 'accdep_other', 1650, 1659, 1),
   ('depreciation', 'expense', 'OPERATING_EXPENSE', 'operating', 'depreciation', 6700, 6709, 1),
   ('disposal_gains', 'revenue', 'NON_OPERATING_REVENUE', 'operating', 'disposal_gains', 4950, 4959, 1)
  ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;
