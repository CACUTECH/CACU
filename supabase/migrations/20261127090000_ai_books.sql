-- AI on the books (Doc 15; E18 R3, part 2). The assistant answers from the business's own figures through read-only tools.
--
-- Off twice over (AI-012):
-- * CACU's switch, ai_private.settings.books_enabled, stays false until gate G4 is met (data processing terms with the
--   AI provider signed, Doc 15 evaluation bars passed). Turning it on is a reviewed production change.
-- * Each business's owner switches it on or off for the business; it starts off.
-- A books answer is one question of the plan's monthly allowance (AI-011), reserved through the same shared limits.
-- Only metadata is kept (AI-009): who asked, which tools ran, token counts, time taken, the figure check; never the
-- question or the answer. It is kept 90 days. A daily token ceiling turns books answers off for everyone when reached
-- (Doc 15 cost controls); CACU turns them back on after review.
BEGIN;

ALTER TABLE ai_private.settings
  ADD COLUMN books_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN books_daily_tokens integer NOT NULL DEFAULT 2000000 CHECK (books_daily_tokens BETWEEN 1000 AND 100000000),
  ADD COLUMN books_paused_at timestamptz;

CREATE TABLE ai_private.business_books (
 business_id uuid PRIMARY KEY,
 enabled boolean NOT NULL DEFAULT false,
 changed_by uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_private.books_answers (
 actor_id uuid NOT NULL,
 request_key uuid NOT NULL,
 business_id uuid NOT NULL,
 tools text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tools) <= 12),
 input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens BETWEEN 0 AND 10000000),
 output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens BETWEEN 0 AND 10000000),
 latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms BETWEEN 0 AND 600000),
 figure_check text NOT NULL CHECK (figure_check IN ('passed', 'flagged', 'none')),
 status text NOT NULL CHECK (status IN ('completed', 'failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (actor_id, request_key),
 FOREIGN KEY (actor_id, request_key) REFERENCES ai_private.requests (actor_id, request_key)
);
CREATE INDEX books_answers_time_idx ON ai_private.books_answers (created_at);
ALTER TABLE ai_private.business_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_private.business_books FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_private.books_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_private.books_answers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_private.business_books, ai_private.books_answers FROM PUBLIC, anon, authenticated;

-- Whether books answers are available, on for this business, and whether this member may change that (owners only).
CREATE FUNCTION ai_private.books_status(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; config ai_private.settings%ROWTYPE;
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 SELECT * INTO config FROM ai_private.settings WHERE singleton;
 RETURN jsonb_build_object(
  'available', coalesce(config.enabled AND config.books_enabled, false),
  'paused', config.books_paused_at IS NOT NULL AND NOT config.books_enabled,
  'on', coalesce((SELECT enabled FROM ai_private.business_books WHERE business_id=p_business_id), false),
  'may_change', EXISTS (SELECT 1 FROM public.memberships WHERE user_id=actor AND business_id=p_business_id AND is_active AND role::text='owner'));
END;
$f$;

CREATE FUNCTION ai_private.set_books(p_business_id uuid, p_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid;
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.memberships WHERE user_id=actor AND business_id=p_business_id AND is_active AND role::text='owner';
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_OWNER_ONLY' USING ERRCODE='42501'; END IF;
 INSERT INTO ai_private.business_books(business_id, enabled, changed_by) VALUES (p_business_id, p_enabled, actor)
 ON CONFLICT (business_id) DO UPDATE SET enabled=EXCLUDED.enabled, changed_by=EXCLUDED.changed_by, changed_at=now();
 RETURN p_enabled;
END;
$f$;

-- The books gate, then the same reservation as general guidance: plan allowance, suspension and shared limits.
CREATE FUNCTION ai_private.reserve_books(p_business_id uuid, p_request_key uuid, p_fingerprint text, p_model text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
BEGIN
 PERFORM ai_private.actor_for_business(p_business_id);
 IF NOT EXISTS (SELECT 1 FROM ai_private.settings WHERE singleton AND enabled AND books_enabled)
 OR NOT EXISTS (SELECT 1 FROM ai_private.business_books WHERE business_id=p_business_id AND enabled)
 THEN RAISE EXCEPTION 'AI_BOOKS_OFF' USING ERRCODE='P0001'; END IF;
 RETURN ai_private.reserve_chat(p_business_id, p_request_key, p_fingerprint, p_model);
END;
$f$;

-- The answer's metadata, once per reserved request. Past the day's token ceiling, books answers turn off for everyone.
CREATE FUNCTION ai_private.record_books(p_business_id uuid, p_request_key uuid, p_tools text[], p_input_tokens integer,
  p_output_tokens integer, p_latency_ms integer, p_figure_check text, p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; used bigint; ceiling integer; day_start timestamptz;
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 IF p_tools IS NULL OR EXISTS (SELECT 1 FROM unnest(p_tools) t WHERE t !~ '^[a-z_]{1,40}$') THEN
  RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM ai_private.requests WHERE actor_id=actor AND business_id=p_business_id AND request_key=p_request_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 INSERT INTO ai_private.books_answers(actor_id, request_key, business_id, tools, input_tokens, output_tokens, latency_ms, figure_check, status)
 -- Each answer counts at most 50,000 tokens each way, so no one member can trip the shared ceiling alone
 -- (20 answers a day at most, by the shared limits).
 VALUES (actor, p_request_key, p_business_id, p_tools, least(greatest(p_input_tokens, 0), 50000), least(greatest(p_output_tokens, 0), 50000),
         least(greatest(p_latency_ms, 0), 600000), p_figure_check, p_status)
 ON CONFLICT (actor_id, request_key) DO NOTHING;
 DELETE FROM ai_private.books_answers WHERE created_at < now() - interval '90 days';
 day_start:=date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
 SELECT coalesce(sum(input_tokens + output_tokens), 0) INTO used FROM ai_private.books_answers WHERE created_at >= day_start;
 SELECT books_daily_tokens INTO ceiling FROM ai_private.settings WHERE singleton;
 IF used >= ceiling THEN
  UPDATE ai_private.settings SET books_enabled=false, books_paused_at=now() WHERE singleton AND books_enabled;
  RETURN jsonb_build_object('paused', true);
 END IF;
 RETURN jsonb_build_object('paused', false);
END;
$f$;

REVOKE ALL ON FUNCTION ai_private.books_status(uuid), ai_private.set_books(uuid, boolean), ai_private.reserve_books(uuid, uuid, text, text),
  ai_private.record_books(uuid, uuid, text[], integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_private.books_status(uuid), ai_private.set_books(uuid, boolean), ai_private.reserve_books(uuid, uuid, text, text),
  ai_private.record_books(uuid, uuid, text[], integer, integer, integer, text, text) TO authenticated;

CREATE FUNCTION public.get_ai_books_status(p_business_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$ SELECT ai_private.books_status(p_business_id); $f$;
CREATE FUNCTION public.set_ai_books(p_business_id uuid, p_enabled boolean) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$ SELECT ai_private.set_books(p_business_id, p_enabled); $f$;
CREATE FUNCTION public.reserve_ai_books(p_business_id uuid, p_request_key uuid, p_fingerprint text, p_model text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$ SELECT ai_private.reserve_books(p_business_id, p_request_key, p_fingerprint, p_model); $f$;
CREATE FUNCTION public.record_ai_books(p_business_id uuid, p_request_key uuid, p_tools text[], p_input_tokens integer,
  p_output_tokens integer, p_latency_ms integer, p_figure_check text, p_status text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$
 SELECT ai_private.record_books(p_business_id, p_request_key, p_tools, p_input_tokens, p_output_tokens, p_latency_ms, p_figure_check, p_status); $f$;
REVOKE ALL ON FUNCTION public.get_ai_books_status(uuid), public.set_ai_books(uuid, boolean), public.reserve_ai_books(uuid, uuid, text, text),
  public.record_ai_books(uuid, uuid, text[], integer, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_books_status(uuid), public.set_ai_books(uuid, boolean), public.reserve_ai_books(uuid, uuid, text, text),
  public.record_ai_books(uuid, uuid, text[], integer, integer, integer, text, text) TO authenticated;

COMMIT;
