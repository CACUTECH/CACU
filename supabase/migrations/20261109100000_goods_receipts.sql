-- Purchasing, part 2: goods received and supplier returns (Doc 10 purchase-to-payment and rules; Doc 09 PR-18 with
-- goods received not invoiced, 2010).
--  * a goods receipt, against a sent purchase order or on its own, puts stock up at the actual cost and recalculates the
--    weighted-average cost: new average = (on hand x current average + received x received cost) / (on hand + received).
--    Products on the adopted (IFRS) valuation keep their valuation records instead. It posts Dr Inventory,
--    Cr Goods received not invoiced; the supplier's bill (part 3) clears it. A receipt is posted once and never changed;
--  * a supplier return takes goods back out at the cost they were received at (Dr Goods received not invoiced,
--    Cr Inventory), for quantities not yet billed;
--  * Goods received not invoiced is added to a business's chart the first time an owner or admin receives goods, as an
--    added account of the new kind grni (codes 2010 to 2090).
SET LOCAL search_path = accounting, public, pg_catalog;

DO $kinds$ BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step)
VALUES ('grni', 'liability', 'CURRENT_LIABILITY', 'operating', 'grni', 2010, 2090, 10)
ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;

-- id is the request key that received the goods.
CREATE TABLE accounting.goods_receipt (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 number text NOT NULL,
 order_id uuid,
 supplier_id uuid NOT NULL,
 received_on date NOT NULL,
 received_by uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
 total numeric(15,2) NOT NULL CHECK (total > 0),
 posting jsonb NOT NULL,
 PRIMARY KEY (business_id, id),
 UNIQUE (business_id, number)
);
CREATE INDEX goods_receipt_order ON accounting.goods_receipt (business_id, order_id);
CREATE INDEX goods_receipt_supplier ON accounting.goods_receipt (business_id, supplier_id, received_on);

CREATE TABLE accounting.goods_receipt_line (
 business_id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 unit_cost numeric(19,4) NOT NULL CHECK (unit_cost >= 0),
 amount numeric(15,2) NOT NULL CHECK (amount >= 0),
 returned_quantity integer NOT NULL DEFAULT 0,
 billed_quantity integer NOT NULL DEFAULT 0,
 PRIMARY KEY (business_id, receipt_id, item_id),
 FOREIGN KEY (business_id, receipt_id) REFERENCES accounting.goods_receipt(business_id, id),
 CHECK (returned_quantity >= 0 AND billed_quantity >= 0 AND returned_quantity + billed_quantity <= quantity)
);

-- id is the request key that returned the goods.
CREATE TABLE accounting.supplier_return (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 returned_on date NOT NULL,
 returned_by uuid NOT NULL,
 returned_at timestamptz NOT NULL DEFAULT now(),
 total numeric(15,2) NOT NULL CHECK (total >= 0),
 posting jsonb NOT NULL,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (business_id, receipt_id) REFERENCES accounting.goods_receipt(business_id, id)
);

CREATE TABLE accounting.supplier_return_line (
 business_id uuid NOT NULL,
 return_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 amount numeric(15,2) NOT NULL CHECK (amount >= 0),
 PRIMARY KEY (business_id, return_id, item_id),
 FOREIGN KEY (business_id, return_id) REFERENCES accounting.supplier_return(business_id, id)
);

-- A receipt and a return are posted once: only the returned and billed quantities of a receipt line move, and only up.
CREATE FUNCTION accounting.goods_receipt_line_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF (NEW.business_id, NEW.receipt_id, NEW.item_id, NEW.quantity, NEW.unit_cost, NEW.amount)
    IS DISTINCT FROM (OLD.business_id, OLD.receipt_id, OLD.item_id, OLD.quantity, OLD.unit_cost, OLD.amount)
    OR NEW.returned_quantity < OLD.returned_quantity OR NEW.billed_quantity < OLD.billed_quantity THEN
  RAISE EXCEPTION 'RECEIPT_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER goods_receipt_line_moves BEFORE UPDATE ON accounting.goods_receipt_line
 FOR EACH ROW EXECUTE FUNCTION accounting.goods_receipt_line_moves();

-- The cost a receipt or return set on a product in this transaction. The catalogue guard lets the accounting runtime
-- change the cost of a product with stock only to exactly this value, so weighted-average costing cannot be used to
-- change costs any other way.
CREATE TABLE accounting.cost_update (
 business_id uuid NOT NULL,
 item_id uuid NOT NULL,
 cost numeric(19,4) NOT NULL CHECK (cost >= 0),
 source_id uuid NOT NULL,
 txid bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, item_id, source_id)
);

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['goods_receipt', 'goods_receipt_line', 'supplier_return', 'supplier_return_line', 'cost_update'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.goods_receipt, accounting.goods_receipt_line, accounting.supplier_return, accounting.supplier_return_line,
 accounting.cost_update TO cacu_runtime;
GRANT UPDATE (returned_quantity, billed_quantity) ON accounting.goods_receipt_line TO cacu_runtime;

-- The catalogue guard, as before, plus: the accounting runtime may set the cost of a product with stock to the weighted
-- average a goods receipt or supplier return recorded for it in this same transaction.
-- catalog guard begin (only where the catalogue schema exists: every hosted project; bare test databases add it later)
DO $guard$ BEGIN
 IF to_regnamespace('management_private') IS NOT NULL THEN
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION management_private.catalog_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.invoice_items WHERE catalog_item_id=OLD.id) OR EXISTS(SELECT 1 FROM public.transaction_items WHERE catalog_item_id=OLD.id)
   OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE item_id=OLD.id) THEN RAISE EXCEPTION 'ARCHIVE_REQUIRED'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.business_id<>OLD.business_id THEN RAISE EXCEPTION 'ITEM_IMMUTABLE'; END IF;
  IF (NEW.item_type<>OLD.item_type OR (OLD.item_type='PRODUCT' AND NEW.unit_of_measure<>OLD.unit_of_measure)
      OR ((NEW.item_type='PRODUCT' AND NEW.track_stock)<>(OLD.item_type='PRODUCT' AND OLD.track_stock))) AND
    (coalesce(OLD.stock_quantity,0)>0 OR EXISTS(SELECT FROM public.invoice_items WHERE catalog_item_id=OLD.id) OR EXISTS(SELECT FROM public.transaction_items WHERE catalog_item_id=OLD.id) OR EXISTS(SELECT FROM public.inventory_movements WHERE business_id=OLD.business_id AND item_id=OLD.id) OR EXISTS(SELECT FROM accounting.inventory_valuation WHERE business_id=OLD.business_id AND item_id=OLD.id)) THEN RAISE EXCEPTION 'ITEM_STRUCTURE_LOCKED'; END IF;
  IF accounting.active(OLD.business_id) AND OLD.item_type='PRODUCT' AND OLD.track_stock AND coalesce(OLD.stock_quantity,0)>0
    AND NEW.cost_price IS DISTINCT FROM OLD.cost_price AND NOT (
      (session_user='cacu_runtime' OR current_setting('role',true)='cacu_runtime')
      AND (
        (accounting.authorized_writer(OLD.business_id)
         AND EXISTS(SELECT FROM accounting.inventory_valuation v JOIN accounting.inventory_policy p ON p.business_id=v.business_id
           WHERE v.business_id=OLD.business_id AND v.item_id=OLD.id
           AND NEW.cost_price=CASE WHEN v.quantity=0 THEN 0 ELSE round(v.gross_cost/v.quantity,4) END))
        OR EXISTS(SELECT FROM accounting.cost_update c WHERE c.business_id=OLD.business_id AND c.item_id=OLD.id
           AND c.cost=NEW.cost_price AND c.txid=txid_current())
      )
    ) THEN RAISE EXCEPTION 'COST_REVALUATION_REQUIRED'; END IF;
  NEW.version:=OLD.version+1;NEW.updated_by:=coalesce(auth.uid(),NEW.updated_by);NEW.updated_at:=now();
 END IF;
 IF TG_OP='INSERT' OR NEW.sku IS DISTINCT FROM OLD.sku THEN
  IF nullif(btrim(NEW.sku),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.catalog_items WHERE business_id=NEW.business_id AND id<>NEW.id AND lower(btrim(sku))=lower(btrim(NEW.sku))) THEN RAISE EXCEPTION 'DUPLICATE_CODE'; END IF;
 END IF;
 IF NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.catalog_categories WHERE id=NEW.category_id AND business_id=NEW.business_id AND item_type=NEW.item_type) THEN RAISE EXCEPTION 'CATEGORY_INVALID'; END IF;
 IF NEW.supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=NEW.supplier_id AND business_id=NEW.business_id) THEN RAISE EXCEPTION 'SUPPLIER_INVALID'; END IF;
 RETURN NEW;
END;$f$;
$fn$;
  EXECUTE $fn$REVOKE ALL ON FUNCTION management_private.catalog_guard() FROM PUBLIC,anon,authenticated$fn$;
 END IF;
END $guard$;
-- catalog guard end

