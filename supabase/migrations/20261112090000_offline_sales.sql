-- Offline selling and expenses (Doc 10 E17, Doc 13; owner decisions of 7 November 2026).
--  * a till that loses its connection keeps selling for cash or transfer, and expenses can still be recorded; each
--    waits on the device under its request key and is sent when the device is back online. Nothing is final until the
--    server accepts it;
--  * on sync a sale posts as sold when its prices were the catalogue prices at the time of the sale, dated the day it was
--    made, from the outlet it was made at; stock that ran short meanwhile is posted and listed as a shortfall, since the
--    money was taken. An expense posts as recorded;
--  * anything else waits in a review list (an edited price, a discount above the seller's limit, a product on the adopted
--    valuation without the stock, a closed period, an entry more than 7 days old, an expense account no longer in the
--    chart) until someone who approves it posts it as recorded or discards it with a reason. Nothing captured offline is
--    lost.
SET LOCAL search_path = accounting, public, pg_catalog;

-- Every offline entry the server has seen; id is its request key.
CREATE TABLE accounting.offline_entry (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('sale', 'expense')),
 made_by uuid NOT NULL,
 made_at timestamptz NOT NULL,
 payload jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('posted', 'review', 'discarded')),
 reason text CHECK (reason IN ('price', 'discount', 'valuation_stock', 'closed_period', 'too_old', 'item_unavailable', 'account_unavailable')),
 detail text CHECK (length(detail) <= 500),
 received_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid, decided_at timestamptz,
 note text CHECK (length(note) <= 500),
 PRIMARY KEY (business_id, id),
 CHECK (status <> 'review' OR (reason IS NOT NULL AND decided_by IS NULL)),
 CHECK (status <> 'discarded' OR (decided_by IS NOT NULL AND note IS NOT NULL))
);
CREATE INDEX offline_entry_review ON accounting.offline_entry (business_id, status, received_at);
ALTER TABLE accounting.offline_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.offline_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.offline_entry TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.offline_entry TO cacu_runtime;
GRANT UPDATE (status, decided_by, decided_at, note) ON accounting.offline_entry TO cacu_runtime;

-- A product's selling price at a moment: the price before the first price change after it, else today's price. Read from
-- the catalogue's change history, which records every change with its before and after.
CREATE FUNCTION accounting.price_at(p_business_id uuid, p_item_id uuid, p_at timestamptz) RETURNS numeric
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE earlier numeric;
BEGIN
 IF to_regclass('management_private.audit') IS NOT NULL THEN
  EXECUTE $q$SELECT (details->'before'->>'unit_price')::numeric FROM management_private.audit
   WHERE business_id = $1 AND record_id = $2 AND event = 'catalog.update' AND created_at > $3
     AND (details->'before'->>'unit_price') IS DISTINCT FROM (details->'after'->>'unit_price')
   ORDER BY created_at, id LIMIT 1$q$ INTO earlier USING p_business_id, p_item_id, p_at;
 END IF;
 RETURN coalesce(earlier, (SELECT unit_price FROM public.catalog_items WHERE business_id = p_business_id AND id = p_item_id));
END $$;
REVOKE ALL ON FUNCTION accounting.price_at(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.price_at(uuid, uuid, timestamptz) TO cacu_runtime;
