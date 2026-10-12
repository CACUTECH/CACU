-- Additive inventory/workspace management. Review staging before rollout.
BEGIN;
CREATE SCHEMA IF NOT EXISTS management_private;
REVOKE ALL ON SCHEMA management_private FROM PUBLIC,anon,authenticated;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS all_locations boolean NOT NULL DEFAULT true;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS location_id uuid;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS unit_of_measure text NOT NULL DEFAULT 'piece';
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS billing_unit text NOT NULL DEFAULT 'service';
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS tax_code text NOT NULL DEFAULT 'none';
ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_tax_supported CHECK(tax_code='none');
ALTER TABLE public.catalog_items ADD UNIQUE(id,business_id);
CREATE TABLE public.catalog_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.businesses(id),
 item_type text NOT NULL CHECK(item_type IN ('PRODUCT','SERVICE')),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 name_key text GENERATED ALWAYS AS(lower(btrim(name))) STORED,is_active boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1,created_by uuid,updated_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,item_type,name_key),UNIQUE(id,business_id,item_type)
);
-- Legacy text is retained. Existing associations resolve by normalized name in reads.
INSERT INTO public.catalog_categories(business_id,item_type,name)
 SELECT business_id,item_type,min(btrim(category)) FROM public.catalog_items
 WHERE nullif(btrim(category),'') IS NOT NULL GROUP BY business_id,item_type,lower(btrim(category));
CREATE TABLE management_private.legacy_category_associations(
 item_id uuid PRIMARY KEY REFERENCES public.catalog_items(id),business_id uuid NOT NULL,category_id uuid NOT NULL REFERENCES public.catalog_categories(id));
INSERT INTO management_private.legacy_category_associations SELECT c.id,c.business_id,k.id FROM public.catalog_items c JOIN public.catalog_categories k ON k.business_id=c.business_id AND k.item_type=c.item_type AND k.name_key=lower(btrim(c.category));
ALTER TABLE management_private.legacy_category_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_private.legacy_category_associations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items ADD FOREIGN KEY(category_id,business_id,item_type) REFERENCES public.catalog_categories(id,business_id,item_type);
CREATE INDEX catalog_code_lookup ON public.catalog_items(business_id,lower(btrim(sku)));
-- Existing duplicate codes are preserved; controlled mutations also check legacy rows.
CREATE UNIQUE INDEX catalog_new_codes_unique ON public.catalog_items(business_id,lower(btrim(sku))) WHERE created_by IS NOT NULL AND sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_item_catalog_reference ON public.invoice_items(catalog_item_id);
CREATE INDEX IF NOT EXISTS transaction_item_catalog_reference ON public.transaction_items(catalog_item_id);
CREATE INDEX catalog_browse_scope ON public.catalog_items(business_id,item_type,is_active,name,id);
CREATE TABLE public.inventory_movements (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,item_id uuid NOT NULL,actor_id uuid NOT NULL,
 delta integer NOT NULL CHECK(delta<>0),before_quantity integer NOT NULL,after_quantity integer NOT NULL CHECK(after_quantity>=0),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0),entry_date date NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(item_id,business_id) REFERENCES public.catalog_items(id,business_id)
);
CREATE INDEX inventory_movements_item ON public.inventory_movements(business_id,item_id,created_at);
CREATE TABLE public.business_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.businesses(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),is_active boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,business_id)
);
CREATE UNIQUE INDEX business_location_name ON public.business_locations(business_id,lower(btrim(name)));
ALTER TABLE public.memberships ADD FOREIGN KEY(location_id,business_id) REFERENCES public.business_locations(id,business_id);
CREATE TABLE public.business_teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.businesses(id),name text NOT NULL,
 location_id uuid,is_active boolean NOT NULL DEFAULT true,version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,business_id),FOREIGN KEY(location_id,business_id) REFERENCES public.business_locations(id,business_id)
);
CREATE UNIQUE INDEX business_team_name ON public.business_teams(business_id,lower(btrim(name)));
CREATE TABLE public.business_team_members (
 business_id uuid NOT NULL,team_id uuid NOT NULL,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(team_id,user_id),FOREIGN KEY(team_id,business_id) REFERENCES public.business_teams(id,business_id)
);
CREATE TABLE public.business_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES public.businesses(id),email text NOT NULL,
 display_name text,role public.membership_role NOT NULL CHECK(role<>'owner'),all_locations boolean NOT NULL DEFAULT true,location_id uuid,
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','accepted','cancelled')),
 delivery_status text NOT NULL DEFAULT 'not_requested' CHECK(delivery_status IN ('not_requested','requested','failed','unknown')),
 created_by uuid NOT NULL,accepted_by uuid,version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '7 days'),
 FOREIGN KEY(location_id,business_id) REFERENCES public.business_locations(id,business_id)
);
CREATE UNIQUE INDEX pending_business_email ON public.business_invitations(business_id,lower(email)) WHERE status='invited';
CREATE TABLE management_private.requests (
 business_id uuid NOT NULL,request_key uuid NOT NULL,actor_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(business_id,request_key)
);
CREATE TABLE management_private.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,business_id uuid NOT NULL,actor_id uuid,event text NOT NULL,
 record_id uuid,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_audit_scope ON management_private.audit(business_id,actor_id,created_at);
ALTER TABLE management_private.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_private.requests FORCE ROW LEVEL SECURITY;
ALTER TABLE management_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_private.audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA management_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT EXISTS(SELECT 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND is_active);
$f$;
CREATE OR REPLACE FUNCTION public.has_business_role(p_business_id uuid,p_roles public.membership_role[]) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT EXISTS(SELECT 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND is_active AND role=ANY(p_roles));
$f$;
CREATE FUNCTION management_private.authorize(b uuid,roles text[],lock_business boolean DEFAULT false) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF lock_business THEN PERFORM pg_advisory_xact_lock(hashtextextended(b::text,0)); END IF;
 IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=b AND user_id=actor AND is_active AND role::text=ANY(roles) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END;$f$;
REVOKE ALL ON FUNCTION management_private.authorize(uuid,text[],boolean) FROM PUBLIC,anon,authenticated;
DO $f$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['catalog_categories','inventory_movements','business_locations','business_teams','business_team_members','business_invitations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT TO authenticated USING(%s)',tab,CASE WHEN tab IN ('business_locations','business_teams','business_team_members') THEN 'public.has_business_role(business_id,ARRAY[''owner'',''admin'']::public.membership_role[])' ELSE 'public.is_business_member(business_id)' END);
 END LOOP;
END;$f$;
-- Invitations/user identity are manager-only; directory is exposed through the guarded RPC.
REVOKE SELECT ON public.business_invitations FROM authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER ON public.catalog_items,public.memberships FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prevent_last_owner_loss() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(OLD.business_id::text,0));
 IF TG_OP='UPDATE' AND (NEW.business_id<>OLD.business_id OR NEW.user_id<>OLD.user_id) THEN RAISE EXCEPTION 'MEMBERSHIP_IMMUTABLE'; END IF;
 IF OLD.role='owner' AND OLD.is_active AND (TG_OP='DELETE' OR NEW.role<>'owner' OR NOT NEW.is_active) AND
 NOT EXISTS(SELECT 1 FROM public.memberships WHERE business_id=OLD.business_id AND id<>OLD.id AND role='owner' AND is_active) THEN
  RAISE EXCEPTION 'LAST_OWNER'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 NEW.version:=OLD.version+1;RETURN NEW;
END;$f$;
CREATE FUNCTION management_private.catalog_guard() RETURNS trigger
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
    (coalesce(OLD.stock_quantity,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_items WHERE catalog_item_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.transaction_items WHERE catalog_item_id=OLD.id)) THEN RAISE EXCEPTION 'ITEM_STRUCTURE_LOCKED'; END IF;
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
CREATE TRIGGER catalog_management_guard BEFORE INSERT OR UPDATE OR DELETE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION management_private.catalog_guard();
CREATE FUNCTION management_private.item_audit() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 INSERT INTO management_private.audit(business_id,actor_id,event,record_id,details)
 VALUES(NEW.business_id,coalesce(auth.uid(),NEW.updated_by,NEW.created_by),'catalog.'||lower(TG_OP),NEW.id,
 jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,'after',to_jsonb(NEW)));
 RETURN NEW;
END;$f$;
CREATE TRIGGER catalog_management_audit AFTER INSERT OR UPDATE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION management_private.item_audit();
CREATE FUNCTION management_private.item_json(c public.catalog_items) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $f$
 SELECT to_jsonb(c)||jsonb_build_object('unit_price',c.unit_price::text,'cost_price',c.cost_price::text,'track_stock',c.item_type='PRODUCT' AND c.track_stock,
 'structure_locked',(coalesce(c.stock_quantity,0)>0 OR EXISTS(SELECT FROM public.invoice_items WHERE catalog_item_id=c.id) OR EXISTS(SELECT FROM public.transaction_items WHERE catalog_item_id=c.id)),
 'category_id',resolved.id,'category',coalesce(k.name,'Uncategorized'))
 FROM(SELECT coalesce(c.category_id,(SELECT category_id FROM management_private.legacy_category_associations WHERE item_id=c.id AND business_id=c.business_id)) AS id) resolved
 LEFT JOIN public.catalog_categories k ON k.id=resolved.id;
$f$;
CREATE FUNCTION public.management_read(p_business_id uuid,p_section text,p_query jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; rows jsonb; total bigint; page_size integer:=least(100,greatest(1,coalesce((p_query->>'limit')::integer,20)));
 start_at integer:=greatest(0,coalesce((p_query->>'offset')::integer,0)); needle text:=lower(coalesce(p_query->>'search',''));
BEGIN
 actor:=management_private.authorize(p_business_id,CASE WHEN p_section IN ('catalog','options') THEN ARRAY['owner','admin','editor','viewer'] ELSE ARRAY['owner','admin'] END);
 IF p_section='options' THEN
  RETURN jsonb_build_object('categories',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM public.catalog_categories t WHERE business_id=p_business_id),'[]'::jsonb),
   'suppliers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.suppliers WHERE business_id=p_business_id),'[]'::jsonb));
 ELSIF p_section='catalog' THEN
  WITH filtered AS(SELECT c.* FROM public.catalog_items c WHERE business_id=p_business_id
   AND (coalesce(p_query->>'type','')='' OR item_type=p_query->>'type')
   AND (coalesce(p_query->>'status','')='' OR is_active=((p_query->>'status')='active'))
   AND (needle='' OR strpos(lower(name||' '||coalesce(sku,'')||' '||coalesce(management_private.item_json(c)->>'category','')),needle)>0)
   AND (coalesce(p_query->>'category','')='' OR (management_private.item_json(c)->>'category_id')=p_query->>'category' OR (p_query->>'category'='none' AND management_private.item_json(c)->>'category_id' IS NULL))
   AND (coalesce((p_query->>'low_stock')::boolean,false)=false OR(item_type='PRODUCT' AND track_stock AND is_active AND coalesce(stock_quantity,0)<=coalesce(reorder_level,0))))
  SELECT (SELECT count(*) FROM filtered),coalesce((SELECT jsonb_agg(management_private.item_json(f)) FROM(SELECT * FROM filtered ORDER BY name,id LIMIT page_size OFFSET start_at) f),'[]'::jsonb) INTO total,rows;
 ELSIF p_section='users' THEN
  WITH directory AS(
   SELECT m.user_id AS id,m.version,coalesce(m.display_name,p.full_name,u.email,'Unnamed member') AS name,u.email,m.role::text AS role,
    CASE WHEN m.is_active THEN 'active' ELSE 'deactivated' END AS status,m.location_id,m.all_locations,m.created_at,NULL::text AS delivery_status
    FROM public.memberships m LEFT JOIN public.profiles p ON p.id=m.user_id LEFT JOIN auth.users u ON u.id=m.user_id WHERE m.business_id=p_business_id
   UNION ALL SELECT id,version,coalesce(display_name,email),email,role::text,'invited',location_id,all_locations,created_at,delivery_status FROM public.business_invitations WHERE business_id=p_business_id AND status='invited'),
  filtered AS(SELECT * FROM directory WHERE(needle='' OR strpos(lower(name||' '||coalesce(email,'')),needle)>0)
   AND(coalesce(p_query->>'role','')='' OR role=p_query->>'role') AND(coalesce(p_query->>'status','')='' OR status=p_query->>'status')
   AND(coalesce(p_query->>'location','')='' OR location_id::text=p_query->>'location'))
  SELECT(SELECT count(*) FROM filtered),coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM(SELECT * FROM filtered ORDER BY name,id LIMIT page_size OFFSET start_at) f),'[]'::jsonb) INTO total,rows;
 ELSIF p_section='teams' THEN
  SELECT count(*) INTO total FROM public.business_teams WHERE business_id=p_business_id;
  SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(m.display_name,p.full_name,m.user_id::text),'active',m.is_active))
    FROM public.business_team_members tm JOIN public.memberships m ON m.user_id=tm.user_id AND m.business_id=tm.business_id LEFT JOIN public.profiles p ON p.id=m.user_id WHERE tm.team_id=t.id),'[]'::jsonb))),'[]'::jsonb)
   INTO rows FROM(SELECT * FROM public.business_teams WHERE business_id=p_business_id ORDER BY name,id LIMIT page_size OFFSET start_at) t;
 ELSIF p_section='sign-ins' THEN
  WITH events AS(SELECT a.id,a.created_at,a.payload->>'action' AS event,m.user_id,coalesce(m.display_name,p.full_name,m.user_id::text) AS name
   FROM auth.audit_log_entries a JOIN public.memberships m ON m.user_id::text=a.payload->>'actor_id' AND m.business_id=p_business_id LEFT JOIN public.profiles p ON p.id=m.user_id
   WHERE a.payload->>'action' IN ('login','logout','token_refreshed','user_signedup','user_recovery_requested'))
  SELECT(SELECT count(*) FROM events),coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM(SELECT * FROM events ORDER BY created_at DESC,id LIMIT page_size OFFSET start_at) e),'[]'::jsonb) INTO total,rows;
 ELSIF p_section='usage' THEN
  WITH events AS(SELECT id::text,actor_id AS user_id,event,created_at FROM management_private.audit WHERE business_id=p_business_id
   UNION ALL SELECT id::text,user_id,action,created_at FROM public.audit_logs WHERE business_id=p_business_id)
  SELECT(SELECT count(*) FROM events),coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM(SELECT * FROM events ORDER BY created_at DESC,id LIMIT page_size OFFSET start_at) e),'[]'::jsonb) INTO total,rows;
 ELSE RAISE EXCEPTION 'UNKNOWN_SECTION'; END IF;
 RETURN jsonb_build_object('data',rows,'total',total,'role',(SELECT role FROM public.memberships WHERE business_id=p_business_id AND user_id=actor),
 'last_activity',CASE WHEN p_section='usage' THEN greatest((SELECT max(created_at) FROM management_private.audit WHERE business_id=p_business_id),(SELECT max(created_at) FROM public.audit_logs WHERE business_id=p_business_id)) ELSE NULL END,
 'locations',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY name) FROM public.business_locations l WHERE business_id=p_business_id),'[]'::jsonb));
END;$f$;

CREATE FUNCTION management_private.business_today(b uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT timezone(coalesce((SELECT timezone FROM accounting.business_map WHERE business_id=b),'Africa/Lagos'),now())::date;
$f$;
CREATE FUNCTION public.management_write(p_business_id uuid,p_request_key uuid,p_operation text,p_id uuid DEFAULT NULL,p_version bigint DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; actor_role text; fingerprint text; previous management_private.requests%ROWTYPE;
 c public.catalog_items%ROWTYPE; old_c public.catalog_items%ROWTYPE; member public.memberships%ROWTYPE; invitation public.business_invitations%ROWTYPE;
 result jsonb; ident uuid:=coalesce(p_id,gen_random_uuid()); delta integer; opening integer; chosen_category public.catalog_categories%ROWTYPE;
 current_version bigint; requested_role text; loc uuid; whole boolean; native boolean:=session_user='cacu_runtime' OR current_setting('role',true)='cacu_runtime'; k text;
BEGIN
 actor:=management_private.authorize(p_business_id,CASE WHEN p_operation='item.save' AND p_id IS NULL THEN ARRAY['owner','admin','editor'] ELSE ARRAY['owner','admin'] END,true);
 IF p_request_key IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT role::text INTO actor_role FROM public.memberships WHERE business_id=p_business_id AND user_id=actor;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(actor,p_operation,p_id,p_version,p_data)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM management_private.requests WHERE business_id=p_business_id AND request_key=p_request_key;
 IF FOUND THEN IF previous.actor_id<>actor OR previous.payload_hash<>fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED'; END IF; RETURN previous.result||'{"replayed":true}'::jsonb; END IF;
 IF p_operation='item.save' THEN
  FOR k IN SELECT jsonb_object_keys(p_data) LOOP
   IF k<>ALL(ARRAY['name','item_type','category_id','sku','description','unit_of_measure','billing_unit','unit_price','cost_price','track_stock','opening_quantity','opening_date','reorder_level','barcode','supplier_id','notes','tax_code','is_active','duration']) THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD: %',k; END IF;
  END LOOP;
  IF p_id IS NOT NULL THEN
   SELECT * INTO old_c FROM public.catalog_items WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
   IF p_version IS DISTINCT FROM old_c.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF p_data ? 'opening_quantity' OR p_data ? 'opening_date' THEN RAISE EXCEPTION 'USE_STOCK_ADJUSTMENT'; END IF;
   c:=jsonb_populate_record(old_c,p_data-'opening_quantity'-'opening_date');
  ELSE
   c:=jsonb_populate_record(NULL::public.catalog_items,jsonb_build_object('id',ident,'business_id',p_business_id,'item_type','PRODUCT','unit_price',0,'cost_price',0,'unit_of_measure','piece','billing_unit','service','track_stock',true,'reorder_level',0,'is_active',true,'tax_code','none','duration',0,'version',1,'created_at',now(),'updated_at',now())||(p_data-'opening_quantity'-'opening_date'));
   c.stock_quantity:=0;c.created_by:=actor;
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_data) LOOP
   IF k IN ('unit_price','cost_price') AND (p_id IS NULL OR (p_data->>k)::numeric IS DISTINCT FROM (to_jsonb(old_c)->>k)::numeric)
   AND coalesce(p_data->>k,'') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'AMOUNT_PRECISION'; END IF;
  END LOOP;
  c.name:=btrim(c.name);c.sku:=coalesce(nullif(btrim(c.sku),''),left(c.item_type,1)||'-'||left(replace(ident::text,'-',''),12));c.updated_by:=actor;
  IF c.name IS NULL OR length(c.name) NOT BETWEEN 1 AND 200 OR c.item_type NOT IN ('PRODUCT','SERVICE') OR c.is_active IS NULL OR c.track_stock IS NULL
   OR c.unit_of_measure NOT IN ('piece','pack','carton','kg','litre') OR c.billing_unit NOT IN ('service','hour','day','project') OR c.tax_code<>'none'
   OR coalesce(c.reorder_level,0)<0 OR coalesce(c.duration,0)<0 OR length(c.sku)>100 OR length(coalesce(c.description,''))>5000 OR length(coalesce(c.notes,''))>5000 THEN RAISE EXCEPTION 'INVALID_ITEM'; END IF;
  IF c.unit_price IS NULL OR c.unit_price<0 OR coalesce(c.cost_price,0)<0 OR c.unit_price>=10000000000000 OR c.cost_price>=10000000000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF(p_id IS NULL OR c.unit_price IS DISTINCT FROM old_c.unit_price) AND c.unit_price<>round(c.unit_price,2) OR(p_id IS NULL OR c.cost_price IS DISTINCT FROM old_c.cost_price) AND c.cost_price<>round(c.cost_price,2) THEN RAISE EXCEPTION 'AMOUNT_PRECISION'; END IF;
  IF c.category_id IS NOT NULL THEN
   SELECT * INTO chosen_category FROM public.catalog_categories WHERE id=c.category_id AND business_id=p_business_id AND item_type=c.item_type;
   IF NOT FOUND OR(NOT chosen_category.is_active AND(p_id IS NULL OR c.category_id IS DISTINCT FROM coalesce(old_c.category_id,(SELECT category_id FROM management_private.legacy_category_associations WHERE item_id=old_c.id)))) THEN RAISE EXCEPTION 'CATEGORY_INVALID'; END IF;
   c.category:=chosen_category.name;
  ELSIF p_data ? 'category_id' THEN c.category:=NULL;DELETE FROM management_private.legacy_category_associations WHERE item_id=c.id AND business_id=p_business_id; END IF;
  opening:=coalesce((p_data->>'opening_quantity')::integer,0);
  IF opening<0 OR opening>1000000 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  IF c.item_type='SERVICE' THEN c.track_stock:=false;c.reorder_level:=0;IF opening<>0 THEN RAISE EXCEPTION 'SERVICE_HAS_NO_STOCK'; END IF; END IF;
  IF NOT c.track_stock AND opening<>0 THEN RAISE EXCEPTION 'UNTRACKED_HAS_NO_STOCK'; END IF;
  IF opening>0 AND accounting.active(p_business_id) AND NOT native THEN RAISE EXCEPTION 'USE_ACCOUNTING_API'; END IF;
  IF opening>0 AND(coalesce((p_data->>'opening_date')::date,management_private.business_today(p_business_id))>management_private.business_today(p_business_id)) THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
  PERFORM set_config('cacu.catalog_metadata_write','on',true);
  IF p_id IS NULL THEN
   c.stock_quantity:=opening;
   INSERT INTO public.catalog_items(id,business_id,name,sku,category,category_id,item_type,description,unit_price,cost_price,stock_quantity,reorder_level,is_active,unit_of_measure,billing_unit,track_stock,barcode,supplier_id,notes,tax_code,duration,created_by,updated_by)
    VALUES(c.id,c.business_id,c.name,c.sku,c.category,c.category_id,c.item_type,c.description,c.unit_price,c.cost_price,c.stock_quantity,c.reorder_level,c.is_active,c.unit_of_measure,c.billing_unit,c.track_stock,c.barcode,c.supplier_id,c.notes,c.tax_code,c.duration,actor,actor) RETURNING * INTO c;
  ELSE
   UPDATE public.catalog_items SET name=c.name,sku=c.sku,category=c.category,category_id=c.category_id,item_type=c.item_type,description=c.description,unit_price=c.unit_price,cost_price=c.cost_price,
    reorder_level=c.reorder_level,is_active=c.is_active,unit_of_measure=c.unit_of_measure,billing_unit=c.billing_unit,track_stock=c.track_stock,barcode=c.barcode,supplier_id=c.supplier_id,notes=c.notes,tax_code=c.tax_code,duration=c.duration,updated_by=actor,updated_at=now()
    WHERE id=p_id AND business_id=p_business_id RETURNING * INTO c;
  END IF;
  PERFORM set_config('cacu.catalog_metadata_write','off',true);
  IF opening>0 THEN INSERT INTO public.inventory_movements VALUES(p_request_key,p_business_id,c.id,actor,opening,0,opening,coalesce(c.cost_price,0),coalesce((p_data->>'opening_date')::date,management_private.business_today(p_business_id)),'Opening stock',now()); END IF;
  result:=management_private.item_json(c)||jsonb_build_object('movement_id',CASE WHEN opening>0 THEN p_request_key ELSE NULL END);
 ELSIF p_operation='stock.adjust' THEN
  IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>ALL(ARRAY['delta','reason','entry_date'])) THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD'; END IF;
  SELECT * INTO c FROM public.catalog_items WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND OR c.item_type<>'PRODUCT' OR NOT c.track_stock THEN RAISE EXCEPTION 'TRACKED_PRODUCT_REQUIRED'; END IF;
  IF p_version IS DISTINCT FROM c.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF accounting.active(p_business_id) AND NOT native THEN RAISE EXCEPTION 'USE_ACCOUNTING_API'; END IF;
  delta:=(p_data->>'delta')::integer;
  IF delta IS NULL OR delta=0 OR abs(delta::bigint)>1000000 OR length(btrim(coalesce(p_data->>'reason',''))) NOT BETWEEN 1 AND 500 OR(p_data->>'entry_date')::date IS NULL OR(p_data->>'entry_date')::date>management_private.business_today(p_business_id) OR coalesce(c.stock_quantity,0)+delta<0 THEN RAISE EXCEPTION 'INVALID_STOCK_ADJUSTMENT'; END IF;
  INSERT INTO public.inventory_movements VALUES(p_request_key,p_business_id,c.id,actor,delta,coalesce(c.stock_quantity,0),coalesce(c.stock_quantity,0)+delta,coalesce(c.cost_price,0),(p_data->>'entry_date')::date,p_data->>'reason',now());
  UPDATE public.catalog_items SET stock_quantity=coalesce(stock_quantity,0)+delta,updated_by=actor,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  result:=management_private.item_json(c)||jsonb_build_object('movement_id',p_request_key);
 ELSIF p_operation IN ('category.save','location.save','team.save') THEN
  IF length(btrim(coalesce(p_data->>'name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF p_operation='category.save' THEN
   IF p_id IS NULL THEN INSERT INTO public.catalog_categories(id,business_id,item_type,name,created_by,updated_by) VALUES(ident,p_business_id,p_data->>'item_type',btrim(p_data->>'name'),actor,actor) RETURNING to_jsonb(catalog_categories.*) INTO result;
   ELSE UPDATE public.catalog_categories SET name=btrim(p_data->>'name'),is_active=coalesce((p_data->>'is_active')::boolean,is_active),version=version+1,updated_by=actor,updated_at=now() WHERE id=p_id AND business_id=p_business_id AND version=p_version RETURNING to_jsonb(catalog_categories.*) INTO result; END IF;
  ELSIF p_operation='location.save' THEN
   IF p_id IS NULL THEN INSERT INTO public.business_locations(id,business_id,name) VALUES(ident,p_business_id,btrim(p_data->>'name')) RETURNING to_jsonb(business_locations.*) INTO result;
   ELSE UPDATE public.business_locations SET name=btrim(p_data->>'name'),is_active=coalesce((p_data->>'is_active')::boolean,is_active),version=version+1 WHERE id=p_id AND business_id=p_business_id AND version=p_version RETURNING to_jsonb(business_locations.*) INTO result; END IF;
  ELSE
   loc:=nullif(p_data->>'location_id','')::uuid;
   IF loc IS NOT NULL AND NOT EXISTS(SELECT FROM public.business_locations WHERE id=loc AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'LOCATION_INVALID'; END IF;
   IF p_id IS NULL THEN INSERT INTO public.business_teams(id,business_id,name,location_id) VALUES(ident,p_business_id,btrim(p_data->>'name'),loc) RETURNING to_jsonb(business_teams.*) INTO result;
   ELSE UPDATE public.business_teams SET name=btrim(p_data->>'name'),is_active=coalesce((p_data->>'is_active')::boolean,is_active),version=version+1 WHERE id=p_id AND business_id=p_business_id AND version=p_version RETURNING to_jsonb(business_teams.*) INTO result; END IF;
  END IF;
  IF result IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 ELSIF p_operation IN ('member.save','member.status') THEN
  SELECT * INTO member FROM public.memberships WHERE user_id=p_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND OR p_version IS DISTINCT FROM member.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  requested_role:=coalesce(p_data->>'role',member.role::text);
  IF requested_role NOT IN ('owner','admin','editor','viewer') OR(actor_role='admin' AND(member.role='owner' OR requested_role='owner')) THEN RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED'; END IF;
  loc:=nullif(p_data->>'location_id','')::uuid;whole:=coalesce((p_data->>'all_locations')::boolean,true);
  IF requested_role IN ('owner','admin') THEN whole:=true;loc:=NULL; END IF;
  IF NOT whole AND(loc IS NULL OR NOT EXISTS(SELECT FROM public.business_locations WHERE id=loc AND business_id=p_business_id AND is_active)) THEN RAISE EXCEPTION 'LOCATION_INVALID'; END IF;
  IF p_operation='member.save' THEN
   IF length(btrim(coalesce(p_data->>'name',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
   UPDATE public.memberships SET display_name=btrim(p_data->>'name'),role=requested_role::public.membership_role,all_locations=whole,location_id=CASE WHEN whole THEN NULL ELSE loc END WHERE id=member.id RETURNING to_jsonb(memberships.*) INTO result;
  ELSE
   IF jsonb_typeof(p_data->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
   UPDATE public.memberships SET is_active=(p_data->>'is_active')::boolean WHERE id=member.id RETURNING to_jsonb(memberships.*) INTO result;
  END IF;
 ELSIF p_operation IN ('team.add','team.remove') THEN
  SELECT version INTO current_version FROM public.business_teams WHERE id=p_id AND business_id=p_business_id AND is_active FOR UPDATE;
  IF current_version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  SELECT m.* INTO member FROM public.memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.business_id=p_business_id AND lower(u.email)=lower(p_data->>'email') AND (m.is_active OR p_operation='team.remove');
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_BUSINESS_MEMBER_REQUIRED'; END IF;
  SELECT location_id INTO loc FROM public.business_teams WHERE id=p_id;
  IF p_operation='team.add' AND NOT member.all_locations AND member.location_id IS DISTINCT FROM loc THEN RAISE EXCEPTION 'LOCATION_MISMATCH'; END IF;
  IF p_operation='team.add' THEN INSERT INTO public.business_team_members VALUES(p_business_id,p_id,member.user_id,now()) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.business_team_members WHERE team_id=p_id AND user_id=member.user_id; END IF;
  UPDATE public.business_teams SET version=version+1 WHERE id=p_id;result:=jsonb_build_object('id',p_id);
 ELSIF p_operation IN ('invitation.create','invitation.resend','invitation.cancel','invitation.delivery') THEN
  IF p_operation='invitation.create' THEN
   requested_role:=p_data->>'role';loc:=nullif(p_data->>'location_id','')::uuid;whole:=coalesce((p_data->>'all_locations')::boolean,true);
   IF requested_role NOT IN ('admin','editor','viewer') OR requested_role IS NULL OR(p_data->>'email') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(p_data->>'email')>254 THEN RAISE EXCEPTION 'INVALID_INVITATION'; END IF;
   IF requested_role='admin' THEN whole:=true;loc:=NULL; END IF;
   IF NOT whole AND(loc IS NULL OR NOT EXISTS(SELECT FROM public.business_locations WHERE id=loc AND business_id=p_business_id AND is_active)) THEN RAISE EXCEPTION 'LOCATION_INVALID'; END IF;
   IF EXISTS(SELECT FROM public.memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.business_id=p_business_id AND lower(u.email)=lower(p_data->>'email')) THEN RAISE EXCEPTION 'MEMBER_ALREADY_EXISTS'; END IF;
   INSERT INTO public.business_invitations(id,business_id,email,display_name,role,all_locations,location_id,created_by) VALUES(ident,p_business_id,lower(btrim(p_data->>'email')),nullif(btrim(p_data->>'name'),''),requested_role::public.membership_role,whole,CASE WHEN whole THEN NULL ELSE loc END,actor) RETURNING * INTO invitation;
  ELSE
   SELECT * INTO invitation FROM public.business_invitations WHERE id=p_id AND business_id=p_business_id AND status='invited' FOR UPDATE;
   IF NOT FOUND OR invitation.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF p_operation='invitation.resend' THEN
    IF EXISTS(SELECT FROM management_private.audit WHERE business_id=p_business_id AND event IN ('invitation.resend','invitation.create') AND record_id=p_id AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'PLEASE_WAIT_BEFORE_RESENDING'; END IF;
    UPDATE public.business_invitations SET expires_at=now()+interval '7 days',delivery_status='not_requested',version=version+1 WHERE id=p_id RETURNING * INTO invitation;
   ELSIF p_operation='invitation.cancel' THEN UPDATE public.business_invitations SET status='cancelled',version=version+1 WHERE id=p_id RETURNING * INTO invitation;
   ELSE UPDATE public.business_invitations SET delivery_status=CASE WHEN p_data->>'status' IN ('requested','failed','unknown') THEN p_data->>'status' ELSE 'unknown' END,version=version+1 WHERE id=p_id RETURNING * INTO invitation; END IF;
  END IF;
  result:=to_jsonb(invitation);
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
 INSERT INTO management_private.audit(business_id,actor_id,event,record_id,details) VALUES(p_business_id,actor,p_operation,ident,jsonb_build_object('request_key',p_request_key));
 INSERT INTO management_private.requests VALUES(p_business_id,p_request_key,actor,fingerprint,result,now());
 RETURN result||'{"replayed":false}'::jsonb;
END;$f$;

CREATE FUNCTION public.accept_business_invitation(p_invitation_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE i public.business_invitations%ROWTYPE; actor uuid:=auth.uid(); verified_email text;
BEGIN
 SELECT * INTO i FROM public.business_invitations WHERE id=p_invitation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(i.business_id::text,0));
 SELECT * INTO i FROM public.business_invitations WHERE id=p_invitation_id FOR UPDATE;
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
 IF verified_email IS NULL OR verified_email<>lower(i.email) THEN RAISE EXCEPTION 'VERIFIED_INVITED_EMAIL_REQUIRED' USING ERRCODE='42501'; END IF;
 IF i.status='accepted' AND i.accepted_by=actor AND public.is_business_member(i.business_id) THEN RETURN i.business_id; END IF;
 IF i.status<>'invited' OR i.expires_at<=now() OR NOT EXISTS(SELECT FROM public.memberships WHERE business_id=i.business_id AND user_id=i.created_by AND is_active AND role::text IN ('owner','admin')) THEN RAISE EXCEPTION 'INVITATION_UNAVAILABLE'; END IF;
 IF EXISTS(SELECT FROM public.memberships WHERE business_id=i.business_id AND user_id=actor) THEN RAISE EXCEPTION 'MEMBERSHIP_EXISTS_CONTACT_ADMIN'; END IF;
 IF NOT i.all_locations AND NOT EXISTS(SELECT FROM public.business_locations WHERE id=i.location_id AND business_id=i.business_id AND is_active) THEN RAISE EXCEPTION 'LOCATION_INVALID'; END IF;
 INSERT INTO public.memberships(business_id,user_id,role,display_name,all_locations,location_id) VALUES(i.business_id,actor,i.role,i.display_name,i.all_locations,i.location_id);
 UPDATE public.business_invitations SET status='accepted',accepted_by=actor,version=version+1 WHERE id=i.id;
 INSERT INTO management_private.audit(business_id,actor_id,event,record_id) VALUES(i.business_id,actor,'invitation.accept',i.id);
 RETURN i.business_id;
END;$f$;
REVOKE ALL ON FUNCTION public.management_read(uuid,text,jsonb),public.management_write(uuid,uuid,text,uuid,bigint,jsonb),public.accept_business_invitation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.management_read(uuid,text,jsonb),public.management_write(uuid,uuid,text,uuid,bigint,jsonb),public.accept_business_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.management_write(uuid,uuid,text,uuid,bigint,jsonb) TO cacu_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA management_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION accounting.authorized(tenant uuid) RETURNS boolean
         LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
         SELECT tenant = nullif(current_setting('cacu.business_id', true), '')::uuid
         AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.business_id=tenant AND m.is_active
             AND m.user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid);
         $$;
CREATE OR REPLACE FUNCTION accounting.authorized_writer(tenant uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY INVOKER SET search_path=pg_catalog,public,accounting AS $$
 SELECT accounting.authorized(tenant) AND EXISTS(SELECT FROM public.memberships m
 WHERE m.business_id=tenant AND m.is_active AND m.user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 AND m.role::text IN ('owner','admin','editor'));
$$;
CREATE OR REPLACE FUNCTION accounting.lock_membership(tenant uuid, actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result text;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id',true),'')::uuid
 OR actor IS DISTINCT FROM (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid THEN
   RAISE EXCEPTION 'invalid membership scope' USING ERRCODE='42501';
 END IF;
 SELECT role::text INTO result FROM public.memberships
 WHERE business_id=tenant AND user_id=actor AND is_active FOR SHARE;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION accounting.legacy_guard() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog,accounting AS $$
DECLARE tenant uuid;
BEGIN
 tenant=CASE WHEN TG_OP='DELETE' THEN OLD.business_id ELSE NEW.business_id END;
 IF TG_OP='UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id AND
 (accounting.active(OLD.business_id) OR accounting.active(NEW.business_id)) THEN
  RAISE EXCEPTION 'accounting document business is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='catalog_items' THEN
  IF TG_OP IN ('INSERT','UPDATE') AND current_setting('cacu.catalog_metadata_write',true)='on'
  AND public.has_business_role(tenant,ARRAY['owner','admin','editor']::public.membership_role[])
  AND ((TG_OP='INSERT' AND coalesce(NEW.stock_quantity,0)=0) OR (TG_OP='UPDATE' AND NEW.stock_quantity IS NOT DISTINCT FROM OLD.stock_quantity)) THEN RETURN NEW; END IF;
 END IF;
 IF accounting.active(tenant) AND (TG_TABLE_NAME IN ('financial_transactions','journal_entries','journal_lines') OR NOT (session_user='cacu_runtime' OR current_setting('role',true)='cacu_runtime')) THEN
  RAISE EXCEPTION 'business financial cutover requires Python accounting' USING ERRCODE='23514';
 END IF;
 IF accounting.active(tenant) AND NOT accounting.authorized_writer(tenant) THEN
  RAISE EXCEPTION 'authorized runtime writer required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.process_sale_safe(p_business_id uuid,p_customer_id uuid,p_items jsonb,p_payment_method text,p_total_amount numeric,p_request_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; sku public.catalog_items%ROWTYPE; qty integer; total numeric:=0;
 sale uuid; previous legacy_private.sale_requests%ROWTYPE; payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['owner','admin','editor']::public.membership_role[]) THEN
  RAISE EXCEPTION 'Business write permission required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND is_active AND role=ANY(ARRAY['owner','admin','editor']::public.membership_role[]) FOR SHARE;
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
  IF sku.item_type='PRODUCT' AND sku.track_stock AND (sku.stock_quantity IS NULL OR sku.stock_quantity<qty) THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
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
  IF sku.item_type='PRODUCT' AND sku.track_stock THEN UPDATE public.catalog_items SET stock_quantity=stock_quantity-qty,updated_at=now() WHERE id=sku.id AND business_id=p_business_id; END IF;
 END LOOP;
 INSERT INTO public.financial_transactions(business_id,description,amount,type,category,created_by,reference_type,reference_id)
 VALUES(p_business_id,'POS Sale: '||sale,total,'Income','Sales',auth.uid(),'Sale',sale);
 INSERT INTO legacy_private.sale_requests VALUES(p_business_id,p_request_key,auth.uid(),payload,sale,now());
 RETURN sale;
END $$;
CREATE OR REPLACE FUNCTION upload_private.resource_valid(b uuid,p text,r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
SELECT CASE WHEN p='logo' THEN b=r AND EXISTS(SELECT 1 FROM public.businesses WHERE id=b)
 WHEN p='catalog_image' THEN EXISTS(SELECT FROM public.catalog_items WHERE id=r AND business_id=b) WHEN p='receipt' THEN (EXISTS(SELECT 1 FROM public.transactions WHERE id=r AND business_id=b) OR EXISTS(SELECT 1 FROM public.financial_transactions WHERE id=r AND business_id=b))
 WHEN p='invoice_attachment' THEN EXISTS(SELECT 1 FROM public.invoices WHERE id=r AND business_id=b)
 ELSE false END;
$$;
CREATE OR REPLACE FUNCTION public.can_read_upload(b uuid,p text,r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,upload_private AS $$
SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.memberships WHERE business_id=b AND user_id=auth.uid() AND is_active)
 AND upload_private.resource_valid(b,p,r);
$$;
CREATE OR REPLACE FUNCTION public.reserve_upload(p_business_id uuid,p_purpose text,p_resource_id uuid,p_name text,p_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE actor uuid:=auth.uid(); member_role text; budget integer; result public.upload_records;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||p_business_id::text,0));
 SELECT role INTO member_role FROM public.memberships WHERE business_id=p_business_id AND user_id=actor AND is_active FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (p_purpose IN ('logo','catalog_image') AND member_role='editor')
 OR NOT upload_private.resource_valid(p_business_id,p_purpose,p_resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 budget:=CASE WHEN p_purpose IN ('logo','catalog_image') THEN 2097152 ELSE 3145728 END;
 IF p_size IS NULL OR p_size<1 OR p_size>budget THEN RAISE EXCEPTION 'Invalid upload size' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.upload_records WHERE business_id=p_business_id AND created_at>now()-interval '10 minutes') >=30
 OR (SELECT count(*) FROM public.upload_records WHERE business_id=p_business_id AND state='pending')>=10
 OR (SELECT count(*) FROM public.upload_records WHERE business_id=p_business_id AND state IN ('pending','approved','deleting','cleanup_required'))>=100
 OR (SELECT coalesce(sum(reserved_bytes),0) FROM public.upload_records WHERE business_id=p_business_id AND state IN ('pending','approved','deleting','cleanup_required'))+budget>52428800
 THEN RAISE EXCEPTION 'Upload quota exceeded' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.upload_records(business_id,actor_id,purpose,resource_id,original_name,reserved_bytes)
 VALUES(p_business_id,actor,p_purpose,p_resource_id,p_name,budget) RETURNING * INTO result;
 INSERT INTO public.upload_events(upload_id,business_id,actor_id,event) VALUES(result.id,p_business_id,actor,'reserved');
 RETURN to_jsonb(result);
END; $$;
CREATE OR REPLACE FUNCTION public.prepare_upload(p_id uuid,p_extension text,p_mime text,p_size integer,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE record public.upload_records; member_role text;
BEGIN
 SELECT * INTO record FROM public.upload_records WHERE id=p_id FOR UPDATE;
 IF record.id IS NULL OR record.state<>'pending' THEN RAISE EXCEPTION 'Upload unavailable'; END IF;
 SELECT role INTO member_role FROM public.memberships WHERE business_id=record.business_id AND user_id=record.actor_id AND is_active FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (record.purpose IN ('logo','catalog_image') AND member_role='editor')
 OR NOT upload_private.resource_valid(record.business_id,record.purpose,record.resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 IF p_size<1 OR p_size>record.reserved_bytes THEN RAISE EXCEPTION 'Invalid processed size'; END IF;
 UPDATE public.upload_records SET state='pending',extension=p_extension,mime=p_mime,size_bytes=p_size,sha256=p_sha256,reserved_bytes=record.reserved_bytes,updated_at=now() WHERE id=p_id RETURNING * INTO record;
 RETURN to_jsonb(record);
END; $$;
CREATE OR REPLACE FUNCTION public.approve_upload(p_id uuid,p_extension text,p_mime text,p_size integer,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE record public.upload_records; member_role text;
BEGIN
 SELECT * INTO record FROM public.upload_records WHERE id=p_id FOR UPDATE;
 IF record.id IS NULL OR record.state<>'pending' THEN RAISE EXCEPTION 'Upload unavailable'; END IF;
 SELECT role INTO member_role FROM public.memberships WHERE business_id=record.business_id AND user_id=record.actor_id AND is_active FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (record.purpose IN ('logo','catalog_image') AND member_role='editor')
 OR NOT upload_private.resource_valid(record.business_id,record.purpose,record.resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 IF p_size<1 OR p_size>record.reserved_bytes THEN RAISE EXCEPTION 'Invalid processed size'; END IF;
 UPDATE public.upload_records SET state='approved',extension=p_extension,mime=p_mime,size_bytes=p_size,sha256=p_sha256,reserved_bytes=p_size,updated_at=now() WHERE id=p_id RETURNING * INTO record;
 INSERT INTO public.upload_events(upload_id,business_id,actor_id,event) VALUES(record.id,record.business_id,record.actor_id,'approved');
 RETURN to_jsonb(record);
END; $$;
ALTER TABLE public.upload_records DROP CONSTRAINT upload_records_purpose_check;
ALTER TABLE public.upload_records ADD CONSTRAINT upload_records_purpose_check CHECK(purpose IN ('logo','receipt','invoice_attachment','catalog_image'));
-- Column grants are independent of table grants: remove both browser write paths.
DO $f$ DECLARE t text;c text; BEGIN
 FOREACH t IN ARRAY ARRAY['memberships','catalog_items'] LOOP
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
   EXECUTE format('REVOKE INSERT(%I),UPDATE(%I) ON public.%I FROM PUBLIC,anon,authenticated',c,c,t);
  END LOOP;
 END LOOP;
END;$f$;
-- Stock changes now require a reason, version and stable request key.
CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(p_item_id uuid,p_business_id uuid,p_delta integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$ BEGIN RAISE EXCEPTION 'Use versioned, reasoned stock adjustment'; END;$f$;
GRANT SELECT ON public.inventory_movements TO cacu_runtime;
CREATE POLICY native_movements_read ON public.inventory_movements FOR SELECT TO cacu_runtime USING(accounting.authorized(business_id));
CREATE OR REPLACE FUNCTION accounting.lock_collection_account(tenant uuid,source uuid,expected_purpose text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,accounting,pg_temp AS $$
DECLARE available boolean;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id',true),'')::uuid
 OR expected_purpose NOT IN ('cash','bank') OR expected_purpose IS NULL THEN
  RAISE EXCEPTION 'Invalid collection scope' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=tenant AND is_active
 AND user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 AND role::text IN ('owner','admin','editor') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business write permission required' USING ERRCODE='42501'; END IF;
 SELECT true INTO available FROM accounting.account_map m
 JOIN public.accounts a ON a.id=m.account_id AND a.business_id=m.business_id
 JOIN accounting.account n ON n.id=m.library_id AND n.business_id=m.business_id
 JOIN accounting.recyclable r ON r.id=n.id AND r.business_id=n.business_id
 JOIN accounting.business_map b ON b.business_id=m.business_id AND b.entity_id=n.entity_id
 JOIN accounting.entity e ON e.id=b.entity_id AND e.business_id=b.business_id
 WHERE m.business_id=tenant AND m.account_id=source AND m.purpose=expected_purpose
 AND m.flow_section='cash' AND a.is_active AND n.account_type='BANK'
 AND n.currency_id=e.currency_id AND r.deleted_at IS NULL AND b.state='active'
 FOR SHARE OF a,m,n,r,b,e;
 RETURN coalesce(available,false);
END $$;
CREATE OR REPLACE FUNCTION public.record_payment_atomic(p_business_id uuid,p_invoice_id uuid,p_customer_id uuid,p_amount numeric,p_payment_method text,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inv public.invoices%ROWTYPE; previous public.payments%ROWTYPE; collected numeric; payment uuid; customer_email text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['owner','admin','editor']::public.membership_role[]) THEN RAISE EXCEPTION 'Business write permission required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND is_active AND role=ANY(ARRAY['owner','admin','editor']::public.membership_role[]) FOR SHARE;
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
COMMIT;
