-- AI questions a month by plan (Doc 14 TEST-210, SUB-10). The shared rate limits stay; on top, a business's plan sets
-- how many questions it may ask in a Lagos calendar month (General 0, Oga 100, Chairman 500). At the limit a question
-- is refused before anything is recorded, so the counter does not move. A question whose answer failed is not
-- counted. A suspended business asks no questions until it pays. Unbilled businesses keep the shared limits only.
SET LOCAL search_path = public, pg_catalog;

-- Questions counted this month: reserved and completed, not failed. Zero where the AI tables do not exist.
CREATE FUNCTION platform.ai_questions_used(p_business_id uuid, p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF to_regclass('ai_private.requests') IS NULL THEN RETURN 0; END IF;
 RETURN (SELECT count(*) FROM ai_private.requests
          WHERE business_id = p_business_id AND status <> 'failed'
            AND created_at >= date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos');
END $$;

-- {limit, used, remaining, resets_at}. limit is null when unlimited or unbilled (billed false).
CREATE FUNCTION platform.ai_quota(p_business_id uuid, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE allowed jsonb := platform.entitlement(p_business_id, 'ai.queries_per_month'); used integer := platform.ai_questions_used(p_business_id, p_now);
BEGIN
 RETURN jsonb_build_object('billed', allowed IS NOT NULL,
  'limit', CASE WHEN jsonb_typeof(allowed) = 'number' THEN allowed END, 'used', used,
  'remaining', CASE WHEN jsonb_typeof(allowed) = 'number' THEN greatest(allowed::text::integer - used, 0) END,
  'resets_at', (date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos') + interval '1 month') AT TIME ZONE 'Africa/Lagos');
END $$;

-- As before, plus the plan: refused while suspended, and refused at the monthly limit with nothing recorded.
CREATE OR REPLACE FUNCTION ai_private.reserve_chat(p_business_id uuid,p_request_key uuid,p_fingerprint text,p_model text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; config ai_private.settings%ROWTYPE; previous ai_private.requests%ROWTYPE; quota jsonb;
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
 IF NOT platform.writes_allowed(p_business_id) THEN RAISE EXCEPTION 'AI_PLAN_SUSPENDED' USING ERRCODE='P0001'; END IF;
 quota:=platform.ai_quota(p_business_id,current_time_value);
 IF (quota->>'remaining')::integer = 0 THEN
  RAISE EXCEPTION 'AI_MONTHLY_LIMIT' USING ERRCODE='P0001', DETAIL=format('%s of %s used', quota->>'used', quota->>'limit');
 END IF;
 IF (SELECT count(*) FROM ai_private.requests WHERE actor_id=actor AND created_at>=current_time_value-interval '1 minute')>=config.actor_per_minute
 OR (SELECT count(*) FROM ai_private.requests WHERE actor_id=actor AND created_at>=current_time_value-interval '24 hours')>=config.actor_per_day
 OR (SELECT count(*) FROM ai_private.requests WHERE business_id=p_business_id AND created_at>=current_time_value-interval '24 hours')>=config.business_per_day
 OR (SELECT count(*) FROM ai_private.requests WHERE created_at>=current_time_value-interval '24 hours')>=config.global_per_day
 THEN RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001'; END IF;
 INSERT INTO ai_private.requests(actor_id,request_key,business_id,fingerprint,model,created_at)
 VALUES(actor,p_request_key,p_business_id,p_fingerprint,p_model,current_time_value);
 RETURN jsonb_build_object('reserved',true,'status','reserved',
  'remaining',CASE WHEN quota->>'remaining' IS NOT NULL THEN (quota->>'remaining')::integer-1 END);
END;
$f$;

-- Any active member may see the business's AI allowance for this month.
CREATE FUNCTION ai_private.chat_quota(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 PERFORM ai_private.actor_for_business(p_business_id);
 RETURN platform.ai_quota(p_business_id);
END;
$f$;
REVOKE ALL ON FUNCTION ai_private.chat_quota(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION ai_private.chat_quota(uuid) TO authenticated;
CREATE FUNCTION public.get_ai_chat_quota(p_business_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT ai_private.chat_quota(p_business_id);
$f$;
REVOKE ALL ON FUNCTION public.get_ai_chat_quota(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_ai_chat_quota(uuid) TO authenticated;
REVOKE ALL ON FUNCTION platform.ai_questions_used(uuid, timestamptz), platform.ai_quota(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- The billing screen's usage now includes AI questions this month.
CREATE OR REPLACE FUNCTION public.business_plan(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.subscriptions%ROWTYPE; p platform.plans%ROWTYPE; manager boolean;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 manager := EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                    AND role::text IN ('owner','admin'));
 SELECT * INTO s FROM platform.subscriptions WHERE business_id = p_business_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('subscribed', false); END IF;
 SELECT * INTO p FROM platform.plans WHERE code = s.plan_code;
 RETURN jsonb_build_object('subscribed', true, 'plan', p.code, 'plan_name', p.display_name, 'status', s.status,
  'billing_interval', s.billing_interval, 'current_period_end', s.current_period_end, 'grace_ends_at', s.grace_ends_at,
  'scheduled_plan', s.scheduled_plan_code, 'cancel_at_period_end', s.cancel_at_period_end,
  'writes_allowed', platform.writes_allowed(p_business_id),
  'entitlements', (SELECT jsonb_object_agg(e.key, e.value) FROM platform.plan_entitlements e WHERE e.plan_code = s.plan_code),
  'usage', (SELECT jsonb_object_agg(k, platform.usage_count(p_business_id, k))
             FROM unnest(ARRAY['users.max', 'outlets.max', 'catalog.max_items']) k)
           || jsonb_build_object('ai.queries_per_month', platform.ai_questions_used(p_business_id)),
  'card', CASE WHEN manager THEN (SELECT jsonb_build_object('card_type', m.card_type, 'bank', m.bank, 'last4', m.last4,
             'exp_month', m.exp_month, 'exp_year', m.exp_year) FROM platform.payment_methods m WHERE m.business_id = p_business_id) END,
  'renewal', CASE WHEN manager THEN (SELECT jsonb_build_object('invoice', i.number, 'plan', i.plan_code, 'billing_interval', i.billing_interval,
             'total_kobo', i.total_kobo, 'due_at', i.period_start,
             'last_failure', (SELECT a.message FROM platform.charge_attempts a WHERE a.invoice_id = i.id AND a.outcome NOT IN ('activated')
                               ORDER BY a.attempt DESC LIMIT 1))
             FROM platform.invoices i WHERE i.business_id = p_business_id AND i.kind = 'renewal' AND i.status = 'open'
             ORDER BY i.period_start DESC LIMIT 1) END);
END $$;
