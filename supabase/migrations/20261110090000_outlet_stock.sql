-- Purchasing, part 4a: stock per outlet (Doc 10; owner decisions of 7 November 2026).
--  * a product's stock total and its one weighted-average cost stay on the product. Once a business has outlets, the total
--    is split by outlet in accounting.outlet_stock; the split (plus goods in transit, part 4b) always adds up to the total;
--  * the first outlet a business adds takes all its current stock;
--  * every change to a product's stock lands on the outlet named for that action (the transaction setting cacu.outlet,
--    set by the accounting runtime: a till shift's outlet, the outlet receiving goods, the outlet a sale came from), or
--    on the main outlet (the earliest open one) when none is named. Taking out more than the outlet holds takes the rest
--    from other outlets, so no outlet shows less than nothing while the total does not; the runtime refuses that for
--    sales, jobs and supplier returns before it happens;
--  * till shifts and goods receipts record their outlet; stock events record the outlet they moved stock at.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.outlet_stock (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 location_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL DEFAULT 0,
 PRIMARY KEY (business_id, location_id, item_id)
);
CREATE INDEX outlet_stock_item ON accounting.outlet_stock (business_id, item_id);
ALTER TABLE accounting.outlet_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.outlet_stock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.outlet_stock TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT ON accounting.outlet_stock TO cacu_runtime;

ALTER TABLE accounting.till_shift ADD COLUMN location_id uuid;
ALTER TABLE accounting.goods_receipt ADD COLUMN location_id uuid;
ALTER TABLE accounting.stock_event ADD COLUMN location_id uuid;

-- outlet stock begin (only where outlets exist: every hosted project; bare test databases add them later)
DO $outlets$ BEGIN
 IF to_regclass('public.business_locations') IS NOT NULL THEN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'outlet_stock_location') THEN
   ALTER TABLE accounting.outlet_stock ADD CONSTRAINT outlet_stock_location
    FOREIGN KEY (location_id, business_id) REFERENCES public.business_locations(id, business_id);
   ALTER TABLE accounting.till_shift ADD CONSTRAINT till_shift_location
    FOREIGN KEY (location_id, business_id) REFERENCES public.business_locations(id, business_id);
   ALTER TABLE accounting.goods_receipt ADD CONSTRAINT goods_receipt_location
    FOREIGN KEY (location_id, business_id) REFERENCES public.business_locations(id, business_id);
  END IF;

  -- The runtime reads its own business's outlets (names, which are open) for shifts, receipts and stock screens.
  GRANT SELECT ON public.business_locations TO cacu_runtime;
  DROP POLICY IF EXISTS runtime_read ON public.business_locations;
  CREATE POLICY runtime_read ON public.business_locations FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));

  -- The main outlet: the earliest open one, else the earliest.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION accounting.main_outlet(p_business_id uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
 SELECT id FROM public.business_locations WHERE business_id = p_business_id ORDER BY is_active DESC, created_at, id LIMIT 1
$f$$fn$;
  -- The outlet this transaction moves stock at: the one the runtime named, if it is this business's, else the main one.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION accounting.current_outlet(p_business_id uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $f$
 SELECT coalesce((SELECT id FROM public.business_locations WHERE business_id = p_business_id
                  AND id::text = nullif(current_setting('cacu.outlet', true), '')), accounting.main_outlet(p_business_id))
$f$$fn$;
  REVOKE ALL ON FUNCTION accounting.main_outlet(uuid), accounting.current_outlet(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION accounting.main_outlet(uuid), accounting.current_outlet(uuid) TO cacu_runtime;

  -- Keeps the split in step with the product's total.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION accounting.outlet_stock_follow() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
DECLARE delta integer; target uuid; owed integer; taken integer; r record;
BEGIN
 IF TG_OP = 'DELETE' THEN
  DELETE FROM accounting.outlet_stock WHERE business_id = OLD.business_id AND item_id = OLD.id;
  RETURN NULL;
 END IF;
 delta := coalesce(NEW.stock_quantity, 0) - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.stock_quantity, 0) END;
 -- 'none': the change is not at an outlet (goods lost in transit, part 4b).
 IF delta = 0 OR NEW.item_type IS DISTINCT FROM 'PRODUCT' OR current_setting('cacu.outlet', true) = 'none' THEN RETURN NULL; END IF;
 target := accounting.current_outlet(NEW.business_id);
 IF target IS NULL THEN RETURN NULL; END IF;
 IF delta > 0 THEN
  INSERT INTO accounting.outlet_stock(business_id, location_id, item_id, quantity) VALUES (NEW.business_id, target, NEW.id, delta)
  ON CONFLICT (business_id, location_id, item_id) DO UPDATE SET quantity = accounting.outlet_stock.quantity + EXCLUDED.quantity;
  RETURN NULL;
 END IF;
 owed := -delta;
 FOR r IN SELECT location_id, quantity FROM accounting.outlet_stock
          WHERE business_id = NEW.business_id AND item_id = NEW.id AND quantity > 0
          ORDER BY location_id = target DESC, quantity DESC, location_id FOR UPDATE LOOP
  EXIT WHEN owed = 0;
  taken := least(r.quantity, owed);
  UPDATE accounting.outlet_stock SET quantity = quantity - taken
   WHERE business_id = NEW.business_id AND location_id = r.location_id AND item_id = NEW.id;
  owed := owed - taken;
 END LOOP;
 IF owed > 0 THEN
  INSERT INTO accounting.outlet_stock(business_id, location_id, item_id, quantity) VALUES (NEW.business_id, target, NEW.id, -owed)
  ON CONFLICT (business_id, location_id, item_id) DO UPDATE SET quantity = accounting.outlet_stock.quantity + EXCLUDED.quantity;
 END IF;
 RETURN NULL;
END $f$$fn$;
  DROP TRIGGER IF EXISTS outlet_stock_follow ON public.catalog_items;
  CREATE TRIGGER outlet_stock_follow AFTER INSERT OR UPDATE OF stock_quantity OR DELETE ON public.catalog_items
   FOR EACH ROW EXECUTE FUNCTION accounting.outlet_stock_follow();

  -- The first outlet a business adds takes all its stock.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION accounting.outlet_first_stock() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
BEGIN
 IF NOT EXISTS (SELECT FROM public.business_locations WHERE business_id = NEW.business_id AND id <> NEW.id) THEN
  INSERT INTO accounting.outlet_stock(business_id, location_id, item_id, quantity)
  SELECT NEW.business_id, NEW.id, c.id, c.stock_quantity FROM public.catalog_items c
   WHERE c.business_id = NEW.business_id AND c.item_type = 'PRODUCT' AND coalesce(c.stock_quantity, 0) <> 0
  ON CONFLICT (business_id, location_id, item_id) DO NOTHING;
 END IF;
 RETURN NULL;
END $f$$fn$;
  DROP TRIGGER IF EXISTS outlet_first_stock ON public.business_locations;
  CREATE TRIGGER outlet_first_stock AFTER INSERT ON public.business_locations
   FOR EACH ROW EXECUTE FUNCTION accounting.outlet_first_stock();

  -- Stock events record the outlet they moved stock at.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION accounting.stock_event_outlet() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
BEGIN
 IF NEW.location_id IS NULL AND current_setting('cacu.outlet', true) IS DISTINCT FROM 'none' THEN
  NEW.location_id := accounting.current_outlet(NEW.business_id);
 END IF;
 RETURN NEW;
END $f$$fn$;
  DROP TRIGGER IF EXISTS stock_event_outlet ON accounting.stock_event;
  CREATE TRIGGER stock_event_outlet BEFORE INSERT ON accounting.stock_event
   FOR EACH ROW EXECUTE FUNCTION accounting.stock_event_outlet();
  REVOKE ALL ON FUNCTION accounting.outlet_stock_follow(), accounting.outlet_first_stock(), accounting.stock_event_outlet() FROM PUBLIC;

  -- Businesses that already have outlets: their stock starts at the main outlet.
  INSERT INTO accounting.outlet_stock(business_id, location_id, item_id, quantity)
  SELECT c.business_id, accounting.main_outlet(c.business_id), c.id, c.stock_quantity FROM public.catalog_items c
   WHERE c.item_type = 'PRODUCT' AND coalesce(c.stock_quantity, 0) <> 0 AND accounting.main_outlet(c.business_id) IS NOT NULL
     AND NOT EXISTS (SELECT FROM accounting.outlet_stock s WHERE s.business_id = c.business_id)
  ON CONFLICT (business_id, location_id, item_id) DO NOTHING;
 END IF;
END $outlets$;
-- outlet stock end
