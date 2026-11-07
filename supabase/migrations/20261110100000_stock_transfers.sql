-- Purchasing, part 4b: transfers between outlets (Doc 10; owner decision of 7 November 2026: send, then receive).
--  * the sending outlet sends goods (TR-0001): they leave its stock and are in transit. The business's total, and its
--    books, do not change: the goods are still the business's, at the same cost;
--  * the receiving outlet confirms what arrived. That goes into its stock. Anything that did not arrive is a loss with a
--    reason: it leaves the total at the product's cost, Dr Stock adjustments and write-offs, Cr Inventory;
--  * a transfer is recorded once; only its receipt fills in what arrived.
SET LOCAL search_path = accounting, public, pg_catalog;

-- id is the request key that sent the goods.
CREATE TABLE accounting.stock_transfer (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 number text NOT NULL,
 from_location uuid NOT NULL,
 to_location uuid NOT NULL CHECK (to_location <> from_location),
 status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received')),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
 sent_by uuid NOT NULL,
 sent_on date NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 received_by uuid, received_on date, received_at timestamptz,
 receive_note text CHECK (length(receive_note) <= 500),
 loss_value numeric(15,2) CHECK (loss_value >= 0),
 posting jsonb,
 PRIMARY KEY (business_id, id),
 UNIQUE (business_id, number),
 CHECK ((status = 'received') = (received_by IS NOT NULL AND received_on IS NOT NULL AND received_at IS NOT NULL AND loss_value IS NOT NULL))
);
CREATE INDEX stock_transfer_status ON accounting.stock_transfer (business_id, status, sent_at);

CREATE TABLE accounting.stock_transfer_line (
 business_id uuid NOT NULL,
 transfer_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 received_quantity integer CHECK (received_quantity >= 0),
 PRIMARY KEY (business_id, transfer_id, item_id),
 FOREIGN KEY (business_id, transfer_id) REFERENCES accounting.stock_transfer(business_id, id),
 CHECK (received_quantity IS NULL OR received_quantity <= quantity)
);

-- Sent once, received once.
CREATE FUNCTION accounting.stock_transfer_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME = 'stock_transfer' THEN
  IF OLD.status <> 'in_transit' OR NEW.status <> 'received'
     OR (NEW.business_id, NEW.id, NEW.number, NEW.from_location, NEW.to_location, NEW.note, NEW.sent_by, NEW.sent_on, NEW.sent_at)
        IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.number, OLD.from_location, OLD.to_location, OLD.note, OLD.sent_by, OLD.sent_on, OLD.sent_at) THEN
   RAISE EXCEPTION 'TRANSFER_RECORD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
 ELSIF OLD.received_quantity IS NOT NULL
     OR (NEW.business_id, NEW.transfer_id, NEW.item_id, NEW.quantity) IS DISTINCT FROM (OLD.business_id, OLD.transfer_id, OLD.item_id, OLD.quantity) THEN
  RAISE EXCEPTION 'TRANSFER_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_transfer_moves BEFORE UPDATE ON accounting.stock_transfer FOR EACH ROW EXECUTE FUNCTION accounting.stock_transfer_moves();
CREATE TRIGGER stock_transfer_line_moves BEFORE UPDATE ON accounting.stock_transfer_line FOR EACH ROW EXECUTE FUNCTION accounting.stock_transfer_moves();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['stock_transfer', 'stock_transfer_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.stock_transfer, accounting.stock_transfer_line TO cacu_runtime;
GRANT UPDATE (status, received_by, received_on, received_at, receive_note, loss_value, posting) ON accounting.stock_transfer TO cacu_runtime;
GRANT UPDATE (received_quantity) ON accounting.stock_transfer_line TO cacu_runtime;
-- Sending and receiving move goods between outlets without changing the total.
GRANT INSERT, UPDATE (quantity) ON accounting.outlet_stock TO cacu_runtime;

-- transfer outlets begin (only where outlets exist: every hosted project; bare test databases add them later)
DO $outlets$ BEGIN
 IF to_regclass('public.business_locations') IS NOT NULL AND NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'stock_transfer_from') THEN
  ALTER TABLE accounting.stock_transfer ADD CONSTRAINT stock_transfer_from
   FOREIGN KEY (from_location, business_id) REFERENCES public.business_locations(id, business_id);
  ALTER TABLE accounting.stock_transfer ADD CONSTRAINT stock_transfer_to
   FOREIGN KEY (to_location, business_id) REFERENCES public.business_locations(id, business_id);
 END IF;
END $outlets$;
-- transfer outlets end
