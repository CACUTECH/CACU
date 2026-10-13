-- Review-only pilot controls. No provider prompts or answers are persisted.
BEGIN;
CREATE SCHEMA IF NOT EXISTS ai_private;
REVOKE ALL ON SCHEMA ai_private FROM PUBLIC, anon, authenticated;
CREATE TABLE ai_private.settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 allowed_model text,
 actor_per_minute integer NOT NULL DEFAULT 3 CHECK(actor_per_minute BETWEEN 1 AND 10),
 actor_per_day integer NOT NULL DEFAULT 20 CHECK(actor_per_day BETWEEN 1 AND 100),
 business_per_day integer NOT NULL DEFAULT 50 CHECK(business_per_day BETWEEN 1 AND 200),
 global_per_day integer NOT NULL DEFAULT 100 CHECK(global_per_day BETWEEN 1 AND 500)
);
INSERT INTO ai_private.settings(singleton) VALUES(true);
CREATE TABLE ai_private.requests (
 actor_id uuid NOT NULL,
 request_key uuid NOT NULL,
 business_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 model text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY(actor_id,request_key)
);
-- No deletion cascade: deleting a user/business must not refund shared capacity.
CREATE INDEX ai_requests_actor_time_idx ON ai_private.requests(actor_id,created_at);
CREATE INDEX ai_requests_business_time_idx ON ai_private.requests(business_id,created_at);
CREATE INDEX ai_requests_time_idx ON ai_private.requests(created_at);
ALTER TABLE ai_private.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_private.settings FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_private.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_private.requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ai_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION ai_private.actor_for_business(p_business_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users WHERE id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE user_id=actor AND business_id=p_business_id
 AND role::text IN ('owner','admin','editor','viewer') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END;
$f$;
REVOKE ALL ON FUNCTION ai_private.actor_for_business(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION ai_private.chat_status(p_business_id uuid,p_model text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 PERFORM ai_private.actor_for_business(p_business_id);
 RETURN EXISTS(SELECT 1 FROM ai_private.settings WHERE enabled AND allowed_model=p_model);
END;
$f$;
CREATE FUNCTION ai_private.reserve_chat(p_business_id uuid,p_request_key uuid,p_fingerprint text,p_model text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; config ai_private.settings%ROWTYPE; previous ai_private.requests%ROWTYPE;
 current_time_value timestamptz:=clock_timestamp();
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 IF p_request_key IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 -- Small pilot-wide serialization boundary. No lock is held across provider I/O.
 PERFORM pg_advisory_xact_lock(19261012,1);
 current_time_value:=clock_timestamp();
 SELECT * INTO config FROM ai_private.settings WHERE singleton FOR SHARE;
 IF NOT FOUND OR NOT config.enabled OR config.allowed_model IS DISTINCT FROM p_model OR p_model IS NULL
 THEN RAISE EXCEPTION 'AI_DISABLED' USING ERRCODE='P0001'; END IF;
 SELECT * INTO previous FROM ai_private.requests WHERE actor_id=actor AND request_key=p_request_key;
 IF FOUND THEN
  IF previous.business_id<>p_business_id OR previous.fingerprint<>p_fingerprint OR previous.model<>p_model
  THEN RAISE EXCEPTION 'AI_RETRY_CHANGED' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('reserved',false,'status',previous.status);
 END IF;
 IF (SELECT count(*) FROM ai_private.requests WHERE actor_id=actor AND created_at>=current_time_value-interval '1 minute')>=config.actor_per_minute
 OR (SELECT count(*) FROM ai_private.requests WHERE actor_id=actor AND created_at>=current_time_value-interval '24 hours')>=config.actor_per_day
 OR (SELECT count(*) FROM ai_private.requests WHERE business_id=p_business_id AND created_at>=current_time_value-interval '24 hours')>=config.business_per_day
 OR (SELECT count(*) FROM ai_private.requests WHERE created_at>=current_time_value-interval '24 hours')>=config.global_per_day
 THEN RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
 INSERT INTO ai_private.requests(actor_id,request_key,business_id,fingerprint,model,created_at)
 VALUES(actor,p_request_key,p_business_id,p_fingerprint,p_model,current_time_value);
 RETURN jsonb_build_object('reserved',true,'status','reserved');
END;
$f$;
CREATE FUNCTION ai_private.finish_chat(p_business_id uuid,p_request_key uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid;
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 IF p_status IS NULL OR p_status NOT IN ('completed','failed')
 THEN RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 IF p_status='completed' AND NOT EXISTS(SELECT 1 FROM ai_private.settings WHERE enabled)
 THEN RAISE EXCEPTION 'AI_DISABLED' USING ERRCODE='P0001'; END IF;
 UPDATE ai_private.requests SET status=p_status,finished_at=clock_timestamp()
 WHERE actor_id=actor AND business_id=p_business_id AND request_key=p_request_key AND status='reserved';
 RETURN FOUND;
END;
$f$;
REVOKE ALL ON FUNCTION ai_private.chat_status(uuid,text),ai_private.reserve_chat(uuid,uuid,text,text),ai_private.finish_chat(uuid,uuid,text) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA ai_private TO authenticated;
GRANT EXECUTE ON FUNCTION ai_private.chat_status(uuid,text),ai_private.reserve_chat(uuid,uuid,text,text),ai_private.finish_chat(uuid,uuid,text) TO authenticated;
CREATE FUNCTION public.get_ai_chat_status(p_business_id uuid,p_model text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT ai_private.chat_status(p_business_id,p_model);
$f$;
CREATE FUNCTION public.reserve_ai_chat(p_business_id uuid,p_request_key uuid,p_fingerprint text,p_model text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT ai_private.reserve_chat(p_business_id,p_request_key,p_fingerprint,p_model);
$f$;
CREATE FUNCTION public.finish_ai_chat(p_business_id uuid,p_request_key uuid,p_status text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT ai_private.finish_chat(p_business_id,p_request_key,p_status);
$f$;
REVOKE ALL ON FUNCTION public.get_ai_chat_status(uuid,text),public.reserve_ai_chat(uuid,uuid,text,text),public.finish_ai_chat(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_ai_chat_status(uuid,text),public.reserve_ai_chat(uuid,uuid,text,text),public.finish_ai_chat(uuid,uuid,text) TO authenticated;
COMMIT;
