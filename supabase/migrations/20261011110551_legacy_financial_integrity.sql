-- Staging review required. Legacy cash-basis compatibility only; no native cutover.
BEGIN;
CREATE SCHEMA IF NOT EXISTS legacy_private;
REVOKE ALL ON SCHEMA legacy_private FROM PUBLIC, anon, authenticated;
CREATE TABLE legacy_private.sale_requests (
 business_id uuid NOT NULL REFERENCES public.businesses(id), request_key uuid NOT NULL,
 actor_id uuid NOT NULL, payload jsonb NOT NULL, sale_id uuid NOT NULL REFERENCES public.transactions(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,request_key)
);
ALTER TABLE legacy_private.sale_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_private.sale_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON legacy_private.sale_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.process_sale_safe(p_business_id uuid,p_customer_id uuid,p_items jsonb,p_payment_method text,p_total_amount numeric,p_request_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; sku public.catalog_items%ROWTYPE; qty integer; total numeric:=0;
 sale uuid; previous legacy_private.sale_requests%ROWTYPE; payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['owner','admin','editor']::public.membership_role[]) THEN
  RAISE EXCEPTION 'Business write permission required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND role=ANY(ARRAY['owner','admin','editor']::public.membership_role[]) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business membership required' USING ERRCODE='42501'; END IF;
 IF p_request_key IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'Request key and cart required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 OR octet_length(p_items::text)>65536 THEN RAISE EXCEPTION 'Invalid cart size'; END IF;
 IF lower(p_payment_method) NOT IN ('cash','transfer') OR p_payment_method IS NULL THEN RAISE EXCEPTION 'Verified gateway collection is required for card payments'; END IF;
 IF p_total_amount IS NULL OR p_total_amount::text IN ('NaN','Infinity','-Infinity') OR p_total_amount<=0 OR p_total_amount>9999999999999.99 THEN RAISE EXCEPTION 'Invalid sale total'; END IF;
 payload=jsonb_build_object('items',p_items,'customer',p_customer_id,'method',lower(p_payment_method),'total',p_total_amount);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text||':sale:'||p_request_key::text,0));
 SELECT * INTO previous FROM legacy_private.sale_requests WHERE business_id=p_business_id AND request_key=p_request_key;
 IF FOUND THEN
  IF previous.actor_id<>auth.uid() OR previous.payload<>payload THEN RAISE EXCEPTION 'Request key conflicts with the original sale' USING ERRCODE='23514'; END IF;
  RETURN previous.sale_id;
 END IF;
 IF p_customer_id IS NOT NULL THEN
  PERFORM 1 FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable in this business'; END IF;
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_items))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items)) THEN RAISE EXCEPTION 'Duplicate cart item'; END IF;
 -- Sorted locks prevent opposite-order carts from deadlocking.
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'id' LOOP
  IF coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,6}$' THEN RAISE EXCEPTION 'Positive integer quantity required'; END IF;
  qty=(item->>'quantity')::integer;
  SELECT * INTO sku FROM public.catalog_items WHERE id=(item->>'id')::uuid AND business_id=p_business_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue item unavailable in this business'; END IF;
  IF coalesce(item->>'price','') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' OR (item->>'price')::numeric<>sku.unit_price THEN RAISE EXCEPTION 'Price changed; refresh the cart'; END IF;
  IF sku.item_type='PRODUCT' AND (sku.stock_quantity IS NULL OR sku.stock_quantity<qty) THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  total=total+round(sku.unit_price*qty,2);
 END LOOP;
 IF total<>p_total_amount THEN RAISE EXCEPTION 'Sale total does not match current catalogue prices'; END IF;
 INSERT INTO public.transactions(business_id,customer_id,created_by,status,payment_method,subtotal,total)
 VALUES(p_business_id,p_customer_id,auth.uid(),'completed',lower(p_payment_method),total,total) RETURNING id INTO sale;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO sku FROM public.catalog_items WHERE id=(item->>'id')::uuid AND business_id=p_business_id;
  qty=(item->>'quantity')::integer;
  INSERT INTO public.transaction_items(business_id,transaction_id,catalog_item_id,description,quantity,unit_price,line_total)
  VALUES(p_business_id,sale,sku.id,sku.name,qty,sku.unit_price,round(sku.unit_price*qty,2));
  IF sku.item_type='PRODUCT' THEN UPDATE public.catalog_items SET stock_quantity=stock_quantity-qty,updated_at=now() WHERE id=sku.id AND business_id=p_business_id; END IF;
 END LOOP;
 INSERT INTO public.financial_transactions(business_id,description,amount,type,category,created_by,reference_type,reference_id)
 VALUES(p_business_id,'POS Sale: '||sale,total,'Income','Sales',auth.uid(),'Sale',sale);
 INSERT INTO legacy_private.sale_requests VALUES(p_business_id,p_request_key,auth.uid(),payload,sale,now());
 RETURN sale;
END $$;
REVOKE ALL ON FUNCTION public.process_sale_safe(uuid,uuid,jsonb,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.process_sale_safe(uuid,uuid,jsonb,text,numeric,uuid) TO authenticated;
-- Existing five-argument entrypoint stays price/tenant safe. New callers use
-- process_sale_safe with a stable key; old callers cannot replay across timeouts.
CREATE OR REPLACE FUNCTION public.process_sale(p_business_id uuid,p_customer_id uuid,p_items jsonb,p_payment_method text,p_total_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RETURN public.process_sale_safe(p_business_id,p_customer_id,p_items,p_payment_method,p_total_amount,gen_random_uuid()); END $$;
REVOKE ALL ON FUNCTION public.process_sale(uuid,uuid,jsonb,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.process_sale(uuid,uuid,jsonb,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_payment_atomic(p_business_id uuid,p_invoice_id uuid,p_customer_id uuid,p_amount numeric,p_payment_method text,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inv public.invoices%ROWTYPE; previous public.payments%ROWTYPE; collected numeric; payment uuid; customer_email text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['owner','admin','editor']::public.membership_role[]) THEN RAISE EXCEPTION 'Business write permission required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND role=ANY(ARRAY['owner','admin','editor']::public.membership_role[]) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business membership required' USING ERRCODE='42501'; END IF;
 IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount>9999999999999.99 THEN RAISE EXCEPTION 'Positive two-decimal amount required'; END IF;
 IF p_reference IS NULL OR length(p_reference) NOT BETWEEN 1 AND 128 OR p_reference ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Stable payment reference required'; END IF;
 IF p_payment_method IS NULL OR lower(p_payment_method) NOT IN ('cash','transfer') THEN RAISE EXCEPTION 'Verified gateway collection is required for card payments'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text||':receipt:'||p_reference,0));
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable in this business'; END IF;
 IF p_customer_id IS NOT NULL AND p_customer_id IS DISTINCT FROM inv.customer_id THEN RAISE EXCEPTION 'Customer does not match invoice'; END IF;
 IF inv.customer_id IS NOT NULL THEN
  SELECT coalesce(email,'') INTO customer_email FROM public.customers WHERE id=inv.customer_id AND business_id=p_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable in this business'; END IF;
 ELSE customer_email=''; END IF;
 SELECT * INTO previous FROM public.payments WHERE business_id=p_business_id AND reference=p_reference;
 IF FOUND THEN
  IF previous.invoice_id IS DISTINCT FROM inv.id OR previous.customer_id IS DISTINCT FROM inv.customer_id OR previous.amount<>p_amount OR lower(previous.channel) IS DISTINCT FROM lower(p_payment_method) OR previous.initialized_by IS DISTINCT FROM auth.uid() OR previous.status<>'success' THEN
   RAISE EXCEPTION 'Payment reference conflicts with original receipt' USING ERRCODE='23514'; END IF;
  RETURN previous.id;
 END IF;
 IF inv.type IS DISTINCT FROM 'Invoice' OR inv.status NOT IN ('sent','overdue') THEN RAISE EXCEPTION 'Issued unpaid invoice required'; END IF;
 SELECT coalesce(sum(amount),0) INTO collected FROM public.payments WHERE business_id=p_business_id AND invoice_id=inv.id AND status='success';
 IF p_amount>inv.total-collected THEN RAISE EXCEPTION 'Payment exceeds outstanding invoice balance'; END IF;
 INSERT INTO public.payments(business_id,purpose,invoice_id,customer_id,amount,currency,channel,reference,status,customer_email,initialized_by,initialized_at,verified_at)
 VALUES(p_business_id,'invoice',inv.id,inv.customer_id,p_amount,'NGN',lower(p_payment_method),p_reference,'success',customer_email,auth.uid(),now(),now()) RETURNING id INTO payment;
 UPDATE public.invoices SET status=CASE WHEN collected+p_amount=inv.total THEN 'paid' ELSE inv.status END,updated_at=now() WHERE id=inv.id AND business_id=p_business_id;
 -- Preserve legacy cash-basis reporting: invoice creation records no revenue.
 -- One receipt event per committed payment, referencing its payment UUID.
 INSERT INTO public.financial_transactions(business_id,description,amount,type,category,created_by,reference_type,reference_id)
 VALUES(p_business_id,'Invoice Payment Received',p_amount,'Income','Sales',auth.uid(),'Payment',payment);
 RETURN payment;
END $$;
REVOKE ALL ON FUNCTION public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text) TO authenticated;
-- Read outstanding amounts using exact database decimals, including partial receipts.
CREATE FUNCTION public.legacy_invoice_balances(p_business_id uuid)
RETURNS TABLE(id uuid,total text,outstanding text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['owner','admin','editor','viewer']::public.membership_role[]) THEN
  RAISE EXCEPTION 'Business membership required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT i.id,i.total::text,greatest(i.total-coalesce((
  SELECT sum(p.amount) FROM public.payments p WHERE p.business_id=p_business_id AND p.invoice_id=i.id AND p.status='success'
 ),0),0)::text FROM public.invoices i WHERE i.business_id=p_business_id;
END $$;
REVOKE ALL ON FUNCTION public.legacy_invoice_balances(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.legacy_invoice_balances(uuid) TO authenticated;
COMMIT;
