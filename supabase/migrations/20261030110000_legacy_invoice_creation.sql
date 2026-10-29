-- Legacy invoice creation (Doc 02 BR-003, Doc 09 ACC-004/ACC-005/ACC-015, Doc 10 shared rules).
-- create_invoice_atomic inserted the client's status, prices, totals and number. Hosted invoices accept only
-- draft, sent, paid, overdue and void, and the screen sent 'Pending' or 'Paid', so every creation failed.
-- create_invoice_safe sets status, prices, totals and number on the server and replays a retried request key.
-- Requires 20261030100000_legacy_financial_write_boundary (legacy_private, audit_logs columns).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE legacy_private.invoice_requests (
  business_id uuid NOT NULL, request_key uuid NOT NULL, actor_id uuid NOT NULL, payload_hash text NOT NULL,
  invoice_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (business_id, request_key)
);
ALTER TABLE legacy_private.invoice_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_private.invoice_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON legacy_private.invoice_requests FROM PUBLIC, anon, authenticated;

-- p_items: [{"catalog_item_id": uuid, "quantity": numeric}]; prices come from the catalogue, never the client.
CREATE FUNCTION public.create_invoice_safe(p_business_id uuid, p_request_key uuid, p_type text, p_customer_id uuid,
  p_issue_date date, p_due_date date, p_vat_included boolean, p_notes text, p_items jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid := auth.uid(); fingerprint text; previous legacy_private.invoice_requests%ROWTYPE;
 inv public.invoices%ROWTYPE; today date; prefix text; next_number bigint; line jsonb; item public.catalog_items%ROWTYPE;
 qty numeric; v_subtotal numeric := 0;
BEGIN
 IF actor IS NULL OR p_business_id IS NULL
  OR NOT public.has_business_role(p_business_id, ARRAY['owner','admin','editor']::public.membership_role[]) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':invoice-number', 0));
 fingerprint := encode(sha256(convert_to(jsonb_build_array(actor, p_type, p_customer_id, p_issue_date, p_due_date,
  p_vat_included, p_notes, p_items)::text, 'UTF8')), 'hex');
 SELECT * INTO previous FROM legacy_private.invoice_requests WHERE business_id = p_business_id AND request_key = p_request_key;
 IF FOUND THEN
  IF previous.actor_id <> actor OR previous.payload_hash <> fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = previous.invoice_id;
  RETURN jsonb_build_object('id', inv.id, 'invoice_number', inv.invoice_number, 'status', inv.status, 'total', inv.total, 'replayed', true);
 END IF;
 IF accounting.active(p_business_id) THEN RAISE EXCEPTION 'USE_ACCOUNTING_POSTINGS' USING ERRCODE = '23514'; END IF;
 IF p_type IS NULL OR p_type NOT IN ('Invoice', 'Estimate') THEN RAISE EXCEPTION 'UNSUPPORTED_DOCUMENT' USING ERRCODE = '22023'; END IF;
 IF coalesce(p_vat_included, false) THEN RAISE EXCEPTION 'TAX_NOT_CONFIGURED' USING ERRCODE = '22023'; END IF;
 IF p_type = 'Invoice' AND p_customer_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id) THEN
  RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '22023';
 END IF;
 today := timezone(coalesce((SELECT timezone FROM accounting.business_map WHERE business_id = p_business_id), 'Africa/Lagos'), now())::date;
 IF coalesce(p_issue_date, today) > today OR p_due_date < coalesce(p_issue_date, today) OR length(coalesce(p_notes, '')) > 2000 THEN
  RAISE EXCEPTION 'INVALID_INVOICE' USING ERRCODE = '22023';
 END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'INVALID_INVOICE' USING ERRCODE = '22023';
 END IF;

 prefix := CASE p_type WHEN 'Invoice' THEN 'INV-' ELSE 'EST-' END;
 SELECT coalesce(max(substring(invoice_number FROM length(prefix) + 1)::bigint), 0) + 1 INTO next_number
  FROM public.invoices WHERE business_id = p_business_id AND invoice_number ~ ('^' || prefix || '[0-9]{6,}$');
 INSERT INTO public.invoices(business_id, customer_id, invoice_number, type, status, issue_date, due_date,
   subtotal, tax, total, vat_included, notes)
  VALUES (p_business_id, p_customer_id, prefix || lpad(next_number::text, 6, '0'), p_type,
   CASE p_type WHEN 'Invoice' THEN 'sent' ELSE 'draft' END, coalesce(p_issue_date, today), p_due_date,
   0, 0, 0, false, nullif(btrim(coalesce(p_notes, '')), ''))
  RETURNING * INTO inv;

 FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  BEGIN
   qty := (line->>'quantity')::numeric;
   SELECT * INTO item FROM public.catalog_items
    WHERE id = (line->>'catalog_item_id')::uuid AND business_id = p_business_id AND is_active;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   RAISE EXCEPTION 'INVALID_INVOICE' USING ERRCODE = '22023';
  END;
  IF item.id IS NULL THEN RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF qty IS NULL OR qty <= 0 OR qty > 1000000 OR qty <> round(qty, 3) THEN RAISE EXCEPTION 'INVALID_INVOICE' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.invoice_items(business_id, invoice_id, catalog_item_id, description, quantity, unit_price, line_total)
   VALUES (p_business_id, inv.id, item.id, item.name, qty, item.unit_price, round(qty * item.unit_price, 2));
  v_subtotal := v_subtotal + round(qty * item.unit_price, 2);
 END LOOP;

 UPDATE public.invoices SET subtotal = v_subtotal, total = v_subtotal WHERE id = inv.id RETURNING * INTO inv;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'INVOICE_CREATED', 'invoices', inv.id,
   jsonb_build_object('type', inv.type, 'status', inv.status, 'total', inv.total, 'request_key', p_request_key));
 INSERT INTO legacy_private.invoice_requests VALUES (p_business_id, p_request_key, actor, fingerprint, inv.id, now());
 RETURN jsonb_build_object('id', inv.id, 'invoice_number', inv.invoice_number, 'status', inv.status, 'total', inv.total, 'replayed', false);
END;$f$;

REVOKE ALL ON FUNCTION public.create_invoice_safe(uuid, uuid, text, uuid, date, date, boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_safe(uuid, uuid, text, uuid, date, date, boolean, text, jsonb) TO authenticated;

-- The old writer trusted client status, prices and totals; nothing in the app calls it after this release.
REVOKE EXECUTE ON FUNCTION public.create_invoice_atomic(uuid,uuid,text,text,text,date,date,numeric,numeric,numeric,boolean,text,jsonb)
  FROM PUBLIC, anon, authenticated;
COMMIT;
