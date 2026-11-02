-- Security audit run 1, lead 4 (Doc 16). Deactivated members could still reserve the business's shared AI quota,
-- because ai_private.actor_for_business ignored memberships.is_active.

CREATE OR REPLACE FUNCTION ai_private.actor_for_business(p_business_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users WHERE id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE user_id=actor AND business_id=p_business_id AND is_active
 AND role::text IN ('owner','admin','editor','viewer') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END;
$f$;
REVOKE ALL ON FUNCTION ai_private.actor_for_business(uuid) FROM PUBLIC,anon,authenticated;
