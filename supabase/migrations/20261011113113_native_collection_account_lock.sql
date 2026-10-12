-- Review and apply in staging before deploying native bank selection.
BEGIN;
-- Runtime has read-only source-account grants. This narrow definer performs
-- row locks without granting UPDATE privileges just to enable FOR SHARE.
CREATE FUNCTION accounting.lock_collection_account(tenant uuid,source uuid,expected_purpose text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,accounting,pg_temp AS $$
DECLARE available boolean;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id',true),'')::uuid
 OR expected_purpose NOT IN ('cash','bank') OR expected_purpose IS NULL THEN
  RAISE EXCEPTION 'Invalid collection scope' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id=tenant
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
REVOKE ALL ON FUNCTION accounting.lock_collection_account(uuid,uuid,text) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION accounting.lock_collection_account(uuid,uuid,text) TO cacu_runtime;
COMMIT;
