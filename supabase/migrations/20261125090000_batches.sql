-- Batches and expiry dates (Doc 18 R3 "E09 counts and batches", part 2). Owner decision of 18 November 2026: items
-- marked "track batches" get a batch number and expiry date when goods are received; CACU keeps how many of each batch
-- are left, takes stock leaving from the batch that expires first (sales, adjustments, supplier returns), and lists
-- what expires within 30 days or has expired. Only those items change how stock leaves.
--
-- Batches follow a product's stock total the way outlet stock does: a trigger on catalog_items.stock_quantity.
--  * Stock coming in goes to the batch the runtime names for that action (cacu.batch_no and cacu.batch_expiry, set
--    by a goods receipt); stock coming in without one (a refund, a count that found more) goes to "no batch recorded".
--  * Stock leaving comes from the batch the runtime names (cacu.batch_id: writing off an expired batch, returning a
--    received batch to its supplier), then from unexpired batches earliest expiry first, then from stock with no
--    batch or expiry, and only then from expired batches.
-- Batches are kept for the whole business, not per outlet.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.batch_item (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 item_id uuid NOT NULL,
 started_by uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, item_id)
);

CREATE TABLE accounting.stock_batch (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL,
 batch_no text CHECK (batch_no IS NULL OR length(btrim(batch_no)) BETWEEN 1 AND 60),
 expiry date,
 quantity integer NOT NULL DEFAULT 0,
 received_on date,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id)
);
CREATE UNIQUE INDEX stock_batch_identity ON accounting.stock_batch (business_id, item_id, coalesce(batch_no, ''), coalesce(expiry, 'infinity'::date));
CREATE INDEX stock_batch_expiry ON accounting.stock_batch (business_id, expiry) WHERE quantity > 0;

-- A stock adjustment can name the batch it takes from (writing off an expired batch); a receipt line names the batch
-- it created, so a return to the supplier takes the same goods back.
-- batch columns begin
DO $columns$ BEGIN
 IF to_regclass('accounting.stock_adjustment') IS NOT NULL THEN
  ALTER TABLE accounting.stock_adjustment ADD COLUMN IF NOT EXISTS batch_id uuid;  -- set when the adjustment is requested
 END IF;
 IF to_regclass('accounting.goods_receipt_line') IS NOT NULL THEN
  ALTER TABLE accounting.goods_receipt_line ADD COLUMN IF NOT EXISTS batch_id uuid;
  GRANT UPDATE (batch_id) ON accounting.goods_receipt_line TO cacu_runtime;
 END IF;
END $columns$;
-- batch columns end

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['batch_item', 'stock_batch'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT, DELETE ON accounting.batch_item TO cacu_runtime;
GRANT SELECT, INSERT, DELETE ON accounting.stock_batch TO cacu_runtime;

-- Keeps a tracked product's batches in step with its stock total.
CREATE FUNCTION accounting.batch_follow() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
DECLARE delta integer; owed integer; taken integer; r record; named uuid; v_batch text; v_expiry date; target uuid;
BEGIN
 IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
 delta := coalesce(NEW.stock_quantity, 0) - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.stock_quantity, 0) END;
 IF delta = 0 OR NOT EXISTS (SELECT FROM accounting.batch_item WHERE business_id = NEW.business_id AND item_id = NEW.id) THEN RETURN NULL; END IF;
 IF delta > 0 THEN
  v_batch := nullif(btrim(coalesce(current_setting('cacu.batch_no', true), '')), '');
  v_expiry := nullif(current_setting('cacu.batch_expiry', true), '')::date;
  INSERT INTO accounting.stock_batch (business_id, item_id, batch_no, expiry, quantity, received_on)
   VALUES (NEW.business_id, NEW.id, v_batch, v_expiry, delta, CASE WHEN v_batch IS NOT NULL OR v_expiry IS NOT NULL THEN current_date END)
   ON CONFLICT (business_id, item_id, coalesce(batch_no, ''), coalesce(expiry, 'infinity'::date))
   DO UPDATE SET quantity = accounting.stock_batch.quantity + EXCLUDED.quantity
   RETURNING id INTO target;
  -- The runtime reads back which batch it filled (a goods receipt line keeps it).
  PERFORM set_config('cacu.batch_filled', target::text, true);
  RETURN NULL;
 END IF;
 owed := -delta;
 named := nullif(current_setting('cacu.batch_id', true), '')::uuid;
 FOR r IN SELECT id, quantity FROM accounting.stock_batch
          WHERE business_id = NEW.business_id AND item_id = NEW.id AND quantity > 0
          ORDER BY id = named DESC NULLS LAST,
                   CASE WHEN expiry >= current_date THEN 0 WHEN expiry IS NULL THEN 1 ELSE 2 END,
                   expiry NULLS LAST, created_at
          FOR UPDATE LOOP
  EXIT WHEN owed = 0;
  taken := least(r.quantity, owed);
  UPDATE accounting.stock_batch SET quantity = quantity - taken WHERE business_id = NEW.business_id AND id = r.id;
  owed := owed - taken;
 END LOOP;
 IF owed > 0 THEN  -- more left than the batches held: shown against "no batch recorded" until counted
  INSERT INTO accounting.stock_batch (business_id, item_id, quantity) VALUES (NEW.business_id, NEW.id, -owed)
   ON CONFLICT (business_id, item_id, coalesce(batch_no, ''), coalesce(expiry, 'infinity'::date))
   DO UPDATE SET quantity = accounting.stock_batch.quantity + EXCLUDED.quantity;
 END IF;
 RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION accounting.batch_follow() FROM PUBLIC;
CREATE TRIGGER batch_follow AFTER INSERT OR UPDATE OF stock_quantity ON public.catalog_items
 FOR EACH ROW EXECUTE FUNCTION accounting.batch_follow();
