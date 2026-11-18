-- Customer tags, segments and lifetime value (Doc 10 CRM; Doc 18 R3 "E06 segments"; Doc 05 3F CRM).
--  * a customer can carry tags (wholesale, church, staff, school run...), up to 20, each up to 30 characters;
--  * a segment is a saved rule set on spend in a recent period, how recently the customer bought, how much they owe
--    and their tags, for example "spent over ₦100,000 in 90 days" or "no purchase in 60 days"; every rule must hold;
--  * lifetime value (Chairman, Doc 10 "Empire"): sales to the customer less credit notes and refunds.
-- Customers are evaluated in the accounting API (cacu/accounting/crm.py) from issued invoices and sales.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.customer_tag (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 customer_id uuid NOT NULL,
 tag text NOT NULL CHECK (tag = lower(btrim(tag)) AND length(tag) BETWEEN 1 AND 30),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, customer_id, tag)
);
CREATE INDEX customer_tag_tag ON accounting.customer_tag (business_id, tag);

CREATE TABLE accounting.customer_segment (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 rules jsonb NOT NULL,
 created_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id)
);
CREATE UNIQUE INDEX customer_segment_name ON accounting.customer_segment (business_id, lower(name));

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['customer_tag', 'customer_segment'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT, DELETE ON accounting.customer_tag TO cacu_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting.customer_segment TO cacu_runtime;

-- Lifetime value is a Chairman feature (Doc 10 "Empire"); businesses without a subscription keep everything.
INSERT INTO platform.plan_entitlements (plan_code, key, value) VALUES ('TOP', 'crm.lifetime_value', 'true'::jsonb)
 ON CONFLICT (plan_code, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- The accounting API asks only this yes/no, never the plan's other features.
CREATE FUNCTION accounting.lifetime_value_included(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(platform.entitlement(p_business_id, 'crm.lifetime_value') = 'true'::jsonb,
                 NOT EXISTS (SELECT FROM platform.subscriptions WHERE business_id = p_business_id));
$$;
REVOKE ALL ON FUNCTION accounting.lifetime_value_included(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.lifetime_value_included(uuid) TO cacu_runtime;
