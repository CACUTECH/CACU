-- Private files only. Existing business-assets objects are preserved for revalidation.
CREATE SCHEMA IF NOT EXISTS upload_private;
REVOKE ALL ON SCHEMA upload_private FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('cacu-quarantine','cacu-quarantine',false,3145728,ARRAY['application/octet-stream']),
       ('cacu-approved','cacu-approved',false,3145728,ARRAY['image/png','image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false, file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
UPDATE storage.buckets SET public=false WHERE id IN ('business-assets','business-logos','business-documents');
-- Restrictive policy prevents older broad permissive policies reopening these buckets.
CREATE POLICY cacu_server_only_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id NOT IN ('business-assets','business-logos','business-documents','cacu-quarantine','cacu-approved'))
WITH CHECK (bucket_id NOT IN ('business-assets','business-logos','business-documents','cacu-quarantine','cacu-approved'));
DROP POLICY IF EXISTS business_assets_select ON storage.objects;
DROP POLICY IF EXISTS business_assets_insert ON storage.objects;
DROP POLICY IF EXISTS business_assets_delete ON storage.objects;

CREATE TABLE public.upload_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
 actor_id uuid NOT NULL, purpose text NOT NULL CHECK(purpose IN ('logo','receipt','invoice_attachment')),
 resource_id uuid NOT NULL, original_name text NOT NULL CHECK(original_name ~ '^[A-Za-z0-9 ._-]{1,120}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','deleting','cleanup_required','rejected','deleted')),
 reserved_bytes integer NOT NULL CHECK(reserved_bytes BETWEEN 0 AND 3145728),
 extension text CHECK(extension IN ('png','jpg')), mime text CHECK(mime IN ('image/png','image/jpeg')),
 size_bytes integer CHECK(size_bytes BETWEEN 1 AND 3145728), sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 quarantine_path text GENERATED ALWAYS AS (business_id::text || '/' || id::text) STORED,
 object_path text GENERATED ALWAYS AS (business_id::text || '/' || purpose || '/' || resource_id::text || '/' || id::text || '.' || extension) STORED,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (state <> 'approved' OR (extension IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL
 AND ((extension='png' AND mime='image/png') OR (extension='jpg' AND mime='image/jpeg'))))
);
CREATE INDEX upload_records_quota ON public.upload_records(business_id,state);
CREATE INDEX upload_records_cleanup ON public.upload_records(state,updated_at);
CREATE TABLE public.upload_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, upload_id uuid NOT NULL REFERENCES public.upload_records(id),
 business_id uuid NOT NULL, actor_id uuid NOT NULL, event text NOT NULL CHECK(event IN ('reserved','approved','rejected','delete_requested','deleted','cleanup_required')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.upload_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upload_records, public.upload_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.upload_records TO authenticated;
GRANT ALL ON public.upload_records, public.upload_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.upload_events_id_seq TO service_role;

CREATE FUNCTION upload_private.resource_valid(b uuid,p text,r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
SELECT CASE WHEN p='logo' THEN b=r AND EXISTS(SELECT 1 FROM public.businesses WHERE id=b)
 WHEN p='receipt' THEN (EXISTS(SELECT 1 FROM public.transactions WHERE id=r AND business_id=b) OR EXISTS(SELECT 1 FROM public.financial_transactions WHERE id=r AND business_id=b))
 WHEN p='invoice_attachment' THEN EXISTS(SELECT 1 FROM public.invoices WHERE id=r AND business_id=b)
 ELSE false END;
$$;
REVOKE ALL ON FUNCTION upload_private.resource_valid(uuid,text,uuid) FROM PUBLIC;
CREATE FUNCTION public.can_read_upload(b uuid,p text,r uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,upload_private AS $$
SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.memberships WHERE business_id=b AND user_id=auth.uid())
 AND upload_private.resource_valid(b,p,r);
$$;
REVOKE ALL ON FUNCTION public.can_read_upload(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_upload(uuid,text,uuid) TO authenticated;
CREATE POLICY approved_upload_read ON public.upload_records FOR SELECT TO authenticated
USING (state='approved' AND public.can_read_upload(business_id,purpose,resource_id));

-- Narrow authenticated RPC; quota reservation is serialized per business, not trusted to clients.
CREATE FUNCTION public.reserve_upload(p_business_id uuid,p_purpose text,p_resource_id uuid,p_name text,p_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE actor uuid:=auth.uid(); member_role text; budget integer; result public.upload_records;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||p_business_id::text,0));
 SELECT role INTO member_role FROM public.memberships WHERE business_id=p_business_id AND user_id=actor FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (p_purpose='logo' AND member_role='editor')
 OR NOT upload_private.resource_valid(p_business_id,p_purpose,p_resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 budget:=CASE WHEN p_purpose='logo' THEN 2097152 ELSE 3145728 END;
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
REVOKE ALL ON FUNCTION public.reserve_upload(uuid,text,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_upload(uuid,text,uuid,text,integer) TO authenticated;

-- Service-only promotion repeats authorization: membership may have changed during processing.
-- Persist the generated path while pending, so a crash before promotion cannot orphan a trusted object.
CREATE FUNCTION public.prepare_upload(p_id uuid,p_extension text,p_mime text,p_size integer,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE record public.upload_records; member_role text;
BEGIN
 SELECT * INTO record FROM public.upload_records WHERE id=p_id FOR UPDATE;
 IF record.id IS NULL OR record.state<>'pending' THEN RAISE EXCEPTION 'Upload unavailable'; END IF;
 SELECT role INTO member_role FROM public.memberships WHERE business_id=record.business_id AND user_id=record.actor_id FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (record.purpose='logo' AND member_role='editor')
 OR NOT upload_private.resource_valid(record.business_id,record.purpose,record.resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 IF p_size<1 OR p_size>record.reserved_bytes THEN RAISE EXCEPTION 'Invalid processed size'; END IF;
 UPDATE public.upload_records SET state='pending',extension=p_extension,mime=p_mime,size_bytes=p_size,sha256=p_sha256,reserved_bytes=record.reserved_bytes,updated_at=now() WHERE id=p_id RETURNING * INTO record;
 RETURN to_jsonb(record);
END; $$;
REVOKE ALL ON FUNCTION public.prepare_upload(uuid,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_upload(uuid,text,text,integer,text) TO service_role;

CREATE FUNCTION public.approve_upload(p_id uuid,p_extension text,p_mime text,p_size integer,p_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,upload_private AS $$
DECLARE record public.upload_records; member_role text;
BEGIN
 SELECT * INTO record FROM public.upload_records WHERE id=p_id FOR UPDATE;
 IF record.id IS NULL OR record.state<>'pending' THEN RAISE EXCEPTION 'Upload unavailable'; END IF;
 SELECT role INTO member_role FROM public.memberships WHERE business_id=record.business_id AND user_id=record.actor_id FOR SHARE;
 IF member_role IS NULL OR member_role NOT IN ('owner','admin','editor') OR (record.purpose='logo' AND member_role='editor')
 OR NOT upload_private.resource_valid(record.business_id,record.purpose,record.resource_id) THEN RAISE EXCEPTION 'Upload permission required' USING ERRCODE='42501'; END IF;
 IF p_size<1 OR p_size>record.reserved_bytes THEN RAISE EXCEPTION 'Invalid processed size'; END IF;
 UPDATE public.upload_records SET state='approved',extension=p_extension,mime=p_mime,size_bytes=p_size,sha256=p_sha256,reserved_bytes=p_size,updated_at=now() WHERE id=p_id RETURNING * INTO record;
 INSERT INTO public.upload_events(upload_id,business_id,actor_id,event) VALUES(record.id,record.business_id,record.actor_id,'approved');
 RETURN to_jsonb(record);
END; $$;
REVOKE ALL ON FUNCTION public.approve_upload(uuid,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_upload(uuid,text,text,integer,text) TO service_role;

CREATE FUNCTION public.request_upload_delete(p_business_id uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE record public.upload_records;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE business_id=p_business_id AND user_id=auth.uid() AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Delete permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO record FROM public.upload_records WHERE id=p_id AND business_id=p_business_id AND state='approved' FOR UPDATE;
 IF record.id IS NULL OR NOT public.can_read_upload(record.business_id,record.purpose,record.resource_id) THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.upload_records SET state='deleting',updated_at=now() WHERE id=p_id;
 IF record.purpose='logo' THEN UPDATE public.businesses SET logo_url=NULL WHERE id=p_business_id AND logo_url='/api/files/'||p_id::text||'?preview=true'; END IF;
 INSERT INTO public.upload_events(upload_id,business_id,actor_id,event) VALUES(record.id,p_business_id,auth.uid(),'delete_requested');
 RETURN to_jsonb(record);
END; $$;
REVOKE ALL ON FUNCTION public.request_upload_delete(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_upload_delete(uuid,uuid) TO authenticated;

CREATE FUNCTION public.finish_upload_cleanup(p_id uuid,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE record public.upload_records;
BEGIN
 IF p_state NOT IN ('rejected','deleted','cleanup_required') THEN RAISE EXCEPTION 'Invalid cleanup state'; END IF;
 SELECT * INTO record FROM public.upload_records WHERE id=p_id AND state IN ('pending','approved','deleting','cleanup_required') FOR UPDATE;
 IF record.id IS NULL THEN RAISE EXCEPTION 'Upload unavailable'; END IF;
 UPDATE public.upload_records SET state=p_state,reserved_bytes=CASE WHEN p_state='cleanup_required' THEN reserved_bytes ELSE 0 END,updated_at=now() WHERE id=p_id;
 INSERT INTO public.upload_events(upload_id,business_id,actor_id,event) VALUES(record.id,record.business_id,record.actor_id,p_state);
END; $$;
REVOKE ALL ON FUNCTION public.finish_upload_cleanup(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_upload_cleanup(uuid,text) TO service_role;

-- Claim expired in-flight objects or newly managed files whose resource was deleted. Never touch legacy buckets.
CREATE FUNCTION public.claim_upload_orphans() RETURNS SETOF public.upload_records LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public,upload_private AS $$
 WITH candidates AS (SELECT id FROM public.upload_records WHERE ((state IN ('pending','deleting','cleanup_required') AND updated_at<now()-interval '1 hour') OR (state='approved' AND NOT upload_private.resource_valid(business_id,purpose,resource_id) AND updated_at<now()-interval '1 hour')) ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 100)
 UPDATE public.upload_records SET state='deleting',updated_at=now() WHERE id IN (SELECT id FROM candidates) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_upload_orphans() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_upload_orphans() TO service_role;
