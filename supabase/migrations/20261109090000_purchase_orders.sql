-- Purchasing, part 1: purchase orders (Doc 10 inventory purchase-to-payment and rules; Doc 07 M-12), on Oga and Chairman.
--  * an order to a supplier (PO-0001, ...) lists stocked products, quantities and the expected unit cost;
--  * states: draft -> sent -> partly_received -> received; draft or sent -> cancelled (with a reason). Lines change only
--    while the order is a draft. Receiving (part 2) moves it to partly received or received, through the accounting API;
--  * a purchase order changes nothing in the books: stock and the liability arise when goods arrive (part 2).
SET LOCAL search_path = public, pg_catalog;

-- Whether the business's plan includes purchasing (module.purchasing: Oga and Chairman), for its own members. Unbilled
-- businesses keep every feature until billing launches.
CREATE FUNCTION public.purchasing_allowed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND is_active
                AND user_id = coalesce(auth.uid(), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid))
    AND coalesce(platform.entitlement(p_business_id, 'module.purchasing') = 'true'::jsonb, true);
$$;
REVOKE ALL ON FUNCTION public.purchasing_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchasing_allowed(uuid) TO authenticated, cacu_runtime;

CREATE TABLE public.purchase_orders (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 number text NOT NULL,
 supplier_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partly_received', 'received', 'cancelled')),
 expected_date date,
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 cancel_reason text CHECK (length(cancel_reason) <= 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (business_id, id),
 UNIQUE (business_id, number),
 CHECK ((status = 'draft') = (sent_at IS NULL) OR status = 'cancelled'),
 CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX purchase_orders_open ON public.purchase_orders (business_id, status, created_at);
CREATE INDEX purchase_orders_supplier ON public.purchase_orders (business_id, supplier_id);

CREATE TABLE public.purchase_order_lines (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL,
 order_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
 unit_cost numeric(15,4) NOT NULL CHECK (unit_cost >= 0),
 received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (business_id, order_id, item_id),
 FOREIGN KEY (business_id, order_id) REFERENCES public.purchase_orders(business_id, id)
);

-- The order rules. SECURITY DEFINER so the checks see the business's suppliers and lines whatever the caller may read;
-- they read only rows of NEW's own business and decide nothing about access, which row security does.
CREATE FUNCTION public.purchase_orders_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := auth.uid(); runtime boolean := session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime'; next_no integer;
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF actor IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('po-number:' || NEW.business_id::text, 0));
  SELECT coalesce(max(substring(number FROM 4)::integer), 0) + 1 INTO next_no FROM public.purchase_orders
   WHERE business_id = NEW.business_id AND number ~ '^PO-[0-9]+$';
  NEW.number := 'PO-' || lpad(next_no::text, 4, '0');
  NEW.created_by := actor; NEW.created_at := now(); NEW.status := 'draft'; NEW.sent_at := NULL; NEW.cancel_reason := NULL;
 ELSE
  IF (NEW.business_id, NEW.number, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.business_id, OLD.number, OLD.created_by, OLD.created_at) THEN
   RAISE EXCEPTION 'ORDER_RECORD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('received', 'cancelled') THEN RAISE EXCEPTION 'ORDER_CLOSED' USING ERRCODE = '23514'; END IF;
  IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id AND OLD.status <> 'draft' THEN
   RAISE EXCEPTION 'ORDER_SENT' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NEW.status IN ('partly_received', 'received') THEN
    -- Receiving goods moves stock and the books: only the accounting API does it (part 2).
    IF NOT runtime OR OLD.status NOT IN ('sent', 'partly_received') THEN RAISE EXCEPTION 'ORDER_RECEIVED_BY_API' USING ERRCODE = '23514'; END IF;
   ELSIF (OLD.status, NEW.status) NOT IN (('draft', 'sent'), ('draft', 'cancelled'), ('sent', 'cancelled')) THEN
    RAISE EXCEPTION 'ORDER_STATE_INVALID' USING ERRCODE = '23514';
   END IF;
   IF NEW.status = 'sent' THEN
    IF NOT EXISTS (SELECT FROM public.purchase_order_lines WHERE business_id = NEW.business_id AND order_id = NEW.id) THEN
     RAISE EXCEPTION 'ORDER_EMPTY' USING ERRCODE = '23514';
    END IF;
    NEW.sent_at := now();
   END IF;
   IF NEW.status = 'cancelled' THEN
    NEW.cancel_reason := btrim(coalesce(NEW.cancel_reason, ''));
    IF length(NEW.cancel_reason) < 3 THEN RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = '23514'; END IF;
   END IF;
  ELSE
   NEW.sent_at := OLD.sent_at; NEW.cancel_reason := OLD.cancel_reason;
  END IF;
 END IF;
 NEW.updated_at := now();
 IF (TG_OP = 'INSERT' OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id)
    AND NOT EXISTS (SELECT FROM public.suppliers WHERE business_id = NEW.business_id AND id = NEW.supplier_id) THEN
  RAISE EXCEPTION 'SUPPLIER_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_orders_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_orders_rules BEFORE INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_rules();

-- Lines change only on a draft; they are the business's own stocked products. What has been received is set only by
-- the accounting API.
CREATE FUNCTION public.purchase_order_lines_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
 runtime boolean := session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime'; state text;
BEGIN
 SELECT status INTO state FROM public.purchase_orders WHERE business_id = r.business_id AND id = r.order_id;
 IF TG_OP = 'UPDATE' THEN
  IF (NEW.business_id, NEW.order_id, NEW.item_id) IS DISTINCT FROM (OLD.business_id, OLD.order_id, OLD.item_id) THEN
   RAISE EXCEPTION 'ORDER_RECORD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.received_quantity IS DISTINCT FROM OLD.received_quantity THEN
   IF NOT runtime THEN RAISE EXCEPTION 'ORDER_RECEIVED_BY_API' USING ERRCODE = '23514'; END IF;
   IF (NEW.quantity, NEW.unit_cost) IS DISTINCT FROM (OLD.quantity, OLD.unit_cost) THEN RAISE EXCEPTION 'ORDER_SENT' USING ERRCODE = '23514'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'ORDER_SENT' USING ERRCODE = '23514'; END IF;
 IF TG_OP = 'INSERT' THEN
  NEW.received_quantity := 0;
  IF NOT EXISTS (SELECT FROM public.catalog_items WHERE business_id = NEW.business_id AND id = NEW.item_id AND is_active
                 AND item_type = 'PRODUCT' AND coalesce((to_jsonb(catalog_items) ->> 'track_stock')::boolean, true)) THEN
   RAISE EXCEPTION 'ITEM_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.purchase_order_lines_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_order_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines
 FOR EACH ROW EXECUTE FUNCTION public.purchase_order_lines_rules();

-- Access (Doc 08): inventory.view reads; inventory.create drafts an order and its lines; inventory.edit sends or cancels
-- it. Writes need a plan with purchasing. Orders are cancelled, never deleted.
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_read ON public.purchase_orders FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'inventory.view'));
CREATE POLICY purchase_orders_draft ON public.purchase_orders FOR INSERT TO authenticated
 WITH CHECK (authz.has_permission(business_id, 'inventory.create') AND public.purchasing_allowed(business_id));
CREATE POLICY purchase_orders_change ON public.purchase_orders FOR UPDATE TO authenticated
 USING (authz.has_permission(business_id, 'inventory.edit')) WITH CHECK (authz.has_permission(business_id, 'inventory.edit') AND public.purchasing_allowed(business_id));
CREATE POLICY purchase_orders_runtime_read ON public.purchase_orders FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));
CREATE POLICY purchase_orders_runtime_change ON public.purchase_orders FOR UPDATE TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON public.purchase_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.purchase_orders TO authenticated;
GRANT SELECT, UPDATE ON public.purchase_orders TO cacu_runtime;

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_lines_read ON public.purchase_order_lines FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'inventory.view'));
CREATE POLICY purchase_order_lines_add ON public.purchase_order_lines FOR INSERT TO authenticated
 WITH CHECK (authz.has_permission(business_id, 'inventory.create') AND public.purchasing_allowed(business_id));
CREATE POLICY purchase_order_lines_change ON public.purchase_order_lines FOR UPDATE TO authenticated
 USING (authz.has_permission(business_id, 'inventory.create')) WITH CHECK (authz.has_permission(business_id, 'inventory.create'));
CREATE POLICY purchase_order_lines_remove ON public.purchase_order_lines FOR DELETE TO authenticated USING (authz.has_permission(business_id, 'inventory.create'));
CREATE POLICY purchase_order_lines_runtime_read ON public.purchase_order_lines FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));
CREATE POLICY purchase_order_lines_runtime_change ON public.purchase_order_lines FOR UPDATE TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON public.purchase_order_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_lines TO authenticated;
GRANT SELECT, UPDATE (received_quantity) ON public.purchase_order_lines TO cacu_runtime;

-- Read-only while the subscription is suspended (Doc 14 SUB-10), like the other trading records.
CREATE TRIGGER purchase_orders_read_only_when_suspended BEFORE INSERT OR UPDATE ON public.purchase_orders
 FOR EACH ROW EXECUTE FUNCTION platform.read_only_guard();
