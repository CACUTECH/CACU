-- Review and apply before deploying the matching setup client.
BEGIN;
CREATE SCHEMA IF NOT EXISTS onboarding_private;
REVOKE ALL ON SCHEMA onboarding_private FROM PUBLIC, anon, authenticated;
CREATE TABLE onboarding_private.business_requests (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 fingerprint text NOT NULL,
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id, request_key)
);
CREATE INDEX business_requests_business_id_idx ON onboarding_private.business_requests(business_id);
ALTER TABLE onboarding_private.business_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.business_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_private.business_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION onboarding_private.create_business(p_request_key uuid, p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $function$
DECLARE actor uuid := auth.uid(); previous onboarding_private.business_requests%ROWTYPE;
 created_id uuid; fingerprint_value text; detail_key text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 -- Serializes setup attempts for the same authenticated user, including different keys.
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
 IF p_request_key IS NULL OR jsonb_typeof(p_details) IS DISTINCT FROM 'object'
 OR p_details - ARRAY['name','type','sector','address','email','phone','bank_name','account_number','account_name'] <> '{}'::jsonb
 THEN RAISE EXCEPTION 'Invalid setup details' USING ERRCODE='22023'; END IF;
 FOREACH detail_key IN ARRAY ARRAY['name','type','sector','address','email','phone','bank_name','account_number','account_name'] LOOP
  IF jsonb_typeof(p_details->detail_key) IS DISTINCT FROM 'string'
   OR length(p_details->>detail_key)>1000 OR length(btrim(p_details->>detail_key))=0
  THEN RAISE EXCEPTION 'Invalid setup details' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_details->>'type' NOT IN ('PRODUCT','SERVICE','HYBRID') THEN
  RAISE EXCEPTION 'Invalid setup details' USING ERRCODE='22023';
 END IF;
 fingerprint_value := encode(sha256(convert_to(p_details::text,'UTF8')),'hex');
 SELECT * INTO previous FROM onboarding_private.business_requests
 WHERE actor_id=actor AND request_key=p_request_key;
 IF FOUND THEN
  IF previous.fingerprint<>fingerprint_value THEN
   RAISE EXCEPTION 'Setup retry details changed' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.memberships WHERE business_id=previous.business_id AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business access revoked' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',previous.business_id,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.memberships WHERE user_id=actor) THEN
  RAISE EXCEPTION 'User is already registered with a business' USING ERRCODE='P0001';
 END IF;
 INSERT INTO public.businesses(name,business_type,sector,address,email,phone_number,bank_name,bank_account_number,bank_account_name,created_by)
 VALUES(p_details->>'name',p_details->>'type',p_details->>'sector',p_details->>'address',p_details->>'email',p_details->>'phone',p_details->>'bank_name',p_details->>'account_number',p_details->>'account_name',actor)
 RETURNING id INTO created_id;
 IF NOT EXISTS(SELECT 1 FROM public.memberships WHERE business_id=created_id AND user_id=actor AND role='owner') THEN
  RAISE EXCEPTION 'Owner membership not provisioned';
 END IF;
 INSERT INTO onboarding_private.business_requests(actor_id,request_key,fingerprint,business_id)
 VALUES(actor,p_request_key,fingerprint_value,created_id);
 RETURN jsonb_build_object('id',created_id,'replayed',false);
END;
$function$;
REVOKE ALL ON FUNCTION onboarding_private.create_business(uuid,jsonb) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA onboarding_private TO authenticated;
GRANT EXECUTE ON FUNCTION onboarding_private.create_business(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.create_business_safe(p_request_key uuid,p_details jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $function$
 SELECT onboarding_private.create_business(p_request_key,p_details);
$function$;
REVOKE ALL ON FUNCTION public.create_business_safe(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_safe(uuid,jsonb) TO authenticated;
-- No browser insert bypass, and TRUNCATE does not honor RLS.
REVOKE INSERT, TRUNCATE, TRIGGER, REFERENCES ON public.businesses FROM PUBLIC, anon, authenticated;
DO $block$
DECLARE cols text;
BEGIN
 SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.columns
 WHERE table_schema='public' AND table_name='businesses';
 EXECUTE format('REVOKE INSERT (%s), REFERENCES (%s) ON public.businesses FROM PUBLIC, anon, authenticated',cols,cols);
END;
$block$;
COMMIT;
