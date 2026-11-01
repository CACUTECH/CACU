-- Write rate limits for the accounting API (Doc 11 API-012, Doc 16 SEC-026 "per business on posting bursts").
-- The API runs on many short-lived instances, so the count lives here: one-minute windows per user and per
-- business. The API takes a slot in its own short transaction before each write, so refused and failed attempts
-- count too. Only active writers of the business are counted, so an outsider cannot use up its allowance.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.request_window (
 scope text NOT NULL CHECK (scope IN ('user', 'business')),
 subject uuid NOT NULL,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL,
 PRIMARY KEY (scope, subject, window_start)
);
CREATE INDEX request_window_age ON accounting.request_window (window_start);
ALTER TABLE accounting.request_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.request_window FORCE ROW LEVEL SECURITY;
REVOKE ALL ON accounting.request_window FROM PUBLIC, anon, authenticated, cacu_runtime;

-- Returns 0 when the write may go ahead, otherwise the seconds until the current window ends (Retry-After).
CREATE FUNCTION accounting.take_write_slot(tenant uuid) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid;
 bucket timestamptz := date_trunc('minute', now()); per_user integer; per_business integer;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id', true), '')::uuid OR actor IS NULL THEN
  RAISE EXCEPTION 'Invalid rate limit scope' USING ERRCODE = '42501'; END IF;
 -- Non-members are refused by the request itself; they must not consume the business's allowance.
 PERFORM 1 FROM public.memberships WHERE business_id = tenant AND user_id = actor AND is_active AND role::text IN ('owner', 'admin', 'editor');
 IF NOT FOUND THEN RETURN 0; END IF;
 INSERT INTO accounting.request_window VALUES ('user', actor, bucket, 1)
  ON CONFLICT (scope, subject, window_start) DO UPDATE SET requests = accounting.request_window.requests + 1 RETURNING requests INTO per_user;
 INSERT INTO accounting.request_window VALUES ('business', tenant, bucket, 1)
  ON CONFLICT (scope, subject, window_start) DO UPDATE SET requests = accounting.request_window.requests + 1 RETURNING requests INTO per_business;
 DELETE FROM accounting.request_window WHERE window_start < now() - interval '10 minutes';
 IF per_user > 60 OR per_business > 300 THEN
  RETURN greatest(1, ceil(extract(epoch FROM bucket + interval '1 minute' - now())))::integer;
 END IF;
 RETURN 0;
END $$;
REVOKE ALL ON FUNCTION accounting.take_write_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.take_write_slot(uuid) TO cacu_runtime;
