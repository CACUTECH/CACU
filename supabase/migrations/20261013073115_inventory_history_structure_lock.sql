-- Preserve the meaning of recorded inventory history after stock reaches zero.
BEGIN;
CREATE FUNCTION management_private.item_structure_locked(c public.catalog_items) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $f$
 SELECT coalesce(c.stock_quantity,0)>0
 OR EXISTS(SELECT FROM public.invoice_items WHERE catalog_item_id=c.id)
 OR EXISTS(SELECT FROM public.transaction_items WHERE catalog_item_id=c.id)
 OR EXISTS(SELECT FROM public.inventory_movements WHERE business_id=c.business_id AND item_id=c.id);
$f$;
REVOKE ALL ON FUNCTION management_private.item_structure_locked(public.catalog_items) FROM PUBLIC,anon,authenticated;
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
    management_private.item_structure_locked(OLD) THEN RAISE EXCEPTION 'ITEM_STRUCTURE_LOCKED'; END IF;
  IF accounting.active(OLD.business_id) AND OLD.item_type='PRODUCT' AND OLD.track_stock AND coalesce(OLD.stock_quantity,0)>0
    AND NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN RAISE EXCEPTION 'COST_REVALUATION_REQUIRED'; END IF;
  NEW.version:=OLD.version+1;NEW.updated_by:=coalesce(auth.uid(),NEW.updated_by);NEW.updated_at:=now();
 END IF;
 IF TG_OP='INSERT' OR NEW.sku IS DISTINCT FROM OLD.sku THEN
  IF nullif(btrim(NEW.sku),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.catalog_items WHERE business_id=NEW.business_id AND id<>NEW.id AND lower(btrim(sku))=lower(btrim(NEW.sku))) THEN RAISE EXCEPTION 'DUPLICATE_CODE'; END IF;
 END IF;
 IF NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.catalog_categories WHERE id=NEW.category_id AND business_id=NEW.business_id AND item_type=NEW.item_type) THEN RAISE EXCEPTION 'CATEGORY_INVALID'; END IF;
 IF NEW.supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=NEW.supplier_id AND business_id=NEW.business_id) THEN RAISE EXCEPTION 'SUPPLIER_INVALID'; END IF;
 RETURN NEW;
END;$f$;
CREATE OR REPLACE FUNCTION management_private.item_json(c public.catalog_items) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $f$
 SELECT to_jsonb(c)||jsonb_build_object('unit_price',c.unit_price::text,'cost_price',c.cost_price::text,'track_stock',c.item_type='PRODUCT' AND c.track_stock,
 'structure_locked',management_private.item_structure_locked(c),
 'category_id',resolved.id,'category',coalesce(k.name,'Uncategorized'))
 FROM(SELECT coalesce(c.category_id,(SELECT category_id FROM management_private.legacy_category_associations WHERE item_id=c.id AND business_id=c.business_id)) AS id) resolved
 LEFT JOIN public.catalog_categories k ON k.id=resolved.id;
$f$;
COMMIT;
