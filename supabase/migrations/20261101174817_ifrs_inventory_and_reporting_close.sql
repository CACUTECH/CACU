-- Additive IFRS controls. No template approvals, balances or historical postings are changed.
SET LOCAL search_path = accounting, public, pg_catalog;
CREATE UNIQUE INDEX IF NOT EXISTS ifrs_catalog_tenant_item ON public.catalog_items(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ifrs_accounts_tenant_account ON public.accounts(business_id,id);
CREATE TABLE accounting.inventory_policy (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 formula text NOT NULL CHECK(formula='moving_weighted_average'),
 allowance_account_id uuid NOT NULL,
 FOREIGN KEY(business_id,allowance_account_id) REFERENCES public.accounts(business_id,id),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 10 AND 2000),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounting.inventory_valuation (
 business_id uuid NOT NULL, item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>=0), gross_cost numeric(19,2) NOT NULL CHECK(gross_cost>=0),
 allowance numeric(19,2) NOT NULL DEFAULT 0 CHECK(allowance>=0 AND allowance<=gross_cost),
 last_date date NOT NULL, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(business_id,item_id),
 FOREIGN KEY(business_id,item_id) REFERENCES public.catalog_items(business_id,id),
 CHECK(quantity>0 OR (gross_cost=0 AND allowance=0))
);
CREATE TABLE accounting.inventory_value_event (
 business_id uuid NOT NULL, id uuid NOT NULL, item_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('adoption','receipt','issue','adjustment','nrv','return')),
 entry_date date NOT NULL, quantity integer NOT NULL,
 gross_change numeric(19,2) NOT NULL, allowance_change numeric(19,2) NOT NULL,
 source_id uuid NOT NULL, origin_id uuid, evidence jsonb NOT NULL,
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id),
 FOREIGN KEY(business_id,item_id) REFERENCES accounting.inventory_valuation(business_id,item_id)
);
CREATE INDEX inventory_value_history ON accounting.inventory_value_event(business_id,item_id,entry_date,created_at);
CREATE INDEX inventory_value_origin ON accounting.inventory_value_event(business_id,origin_id) WHERE origin_id IS NOT NULL;
CREATE TABLE accounting.inventory_journal (
 business_id uuid NOT NULL REFERENCES public.businesses(id), source_id uuid NOT NULL,
 PRIMARY KEY(business_id,source_id)
);
CREATE TABLE accounting.cash_flow_classification (
 business_id uuid NOT NULL, account_id uuid NOT NULL, effective_from date NOT NULL,
 nature text NOT NULL CHECK(nature IN ('other','interest_paid','interest_received','dividends_paid','dividends_received','income_tax')),
 section text NOT NULL CHECK(section IN ('cash','operating','investing','financing')),
 cash_eligible boolean NOT NULL DEFAULT false,
 restricted boolean NOT NULL DEFAULT false,
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 10 AND 2000),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,account_id,effective_from),
 FOREIGN KEY(business_id,account_id) REFERENCES public.accounts(business_id,id),
 CHECK((section='cash')=cash_eligible), CHECK(NOT cash_eligible OR nature='other')
);
CREATE TABLE accounting.reporting_close (
 business_id uuid NOT NULL REFERENCES public.businesses(id), id uuid NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date),
 payload jsonb NOT NULL, ledger_hash text NOT NULL, payload_hash text NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id)
);
CREATE TABLE accounting.reporting_close_decision (
 business_id uuid NOT NULL, close_id uuid NOT NULL,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 10 AND 2000),
 PRIMARY KEY(business_id,close_id),
 FOREIGN KEY(business_id,close_id) REFERENCES accounting.reporting_close(business_id,id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['inventory_journal','inventory_policy','inventory_valuation','inventory_value_event','cash_flow_classification','reporting_close','reporting_close_decision'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))',tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT,INSERT ON accounting.%I TO cacu_runtime',tab);
 END LOOP;
END $$;
GRANT UPDATE(quantity,gross_cost,allowance,last_date,version) ON accounting.inventory_valuation TO cacu_runtime;
