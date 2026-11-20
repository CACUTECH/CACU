-- Two-step sign-in (Doc 16 SEC-014, T-01, RSK-041; Doc 10 E22 part 1). Owner decisions of 9 November 2026:
--  * anyone can turn on an authenticator app (Supabase Auth TOTP); it is required for Owners and Admins on the
--    Chairman plan (entitlement security.mfa_required);
--  * someone who has an authenticator, or who must have one, gets nothing from a business until this session has
--    passed the second step (aal2). This is enforced in the database: the shared membership checks used by
--    row-level security and the business functions, and by the accounting API through authz.mfa_ok;
--  * ten single-use recovery codes, stored only as hashes. Using one (with the password) removes the lost
--    authenticator so a new one can be set up; at most five tries an hour.
-- The API's own server jobs (online payment webhooks, the payment check, pay links) act for a staff member without a
-- browser session; they mark their session 'system', which only the runtime role can do.
SET LOCAL search_path = public, pg_catalog;

INSERT INTO platform.plan_entitlements (plan_code, key, value) VALUES ('TOP', 'security.mfa_required', 'true'::jsonb)
 ON CONFLICT (plan_code, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE SCHEMA IF NOT EXISTS security_private;
REVOKE ALL ON SCHEMA security_private FROM PUBLIC, anon, authenticated;

CREATE TABLE security_private.recovery_code (
 user_id uuid NOT NULL,
 code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 used_at timestamptz,
 PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE security_private.recovery_attempt (
 user_id uuid NOT NULL,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 succeeded boolean NOT NULL
);
CREATE INDEX recovery_attempt_recent ON security_private.recovery_attempt (user_id, attempted_at);
ALTER TABLE security_private.recovery_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_private.recovery_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON security_private.recovery_code, security_private.recovery_attempt FROM PUBLIC, anon, authenticated;

-- Whether the person has a verified authenticator. Reads Supabase Auth's own table when it is there.
CREATE FUNCTION authz.mfa_enrolled(p_actor uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF p_actor IS NULL OR to_regclass('auth.mfa_factors') IS NULL THEN RETURN false; END IF;
 RETURN EXISTS (SELECT FROM auth.mfa_factors f WHERE f.user_id = p_actor AND f.status::text = 'verified');
END $$;

-- Whether the business's plan requires the person to use two-step sign-in (Owners and Admins on Chairman).
CREATE FUNCTION authz.mfa_required(p_business_id uuid, p_actor uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 -- A business without a subscription row (before billing) has no requirement: never NULL.
 SELECT coalesce(p_business_id IS NOT NULL AND p_actor IS NOT NULL
  AND platform.entitlement(p_business_id, 'security.mfa_required') = 'true'::jsonb
  AND EXISTS (SELECT FROM public.memberships m WHERE m.business_id = p_business_id AND m.user_id = p_actor AND m.is_active
              AND m.role::text IN ('owner', 'admin')), false);
$$;

-- The session's assurance level: aal2 after the second step; 'system' only for the accounting API's server jobs.
CREATE FUNCTION authz.session_level() RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE level text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
BEGIN
 IF level = 'system' AND NOT (EXISTS (SELECT FROM pg_roles WHERE rolname = 'cacu_runtime') AND pg_has_role(session_user, 'cacu_runtime', 'MEMBER')) THEN
  RETURN 'aal1';
 END IF;
 RETURN level;
END $$;

-- True unless the signed-in person must pass the second step for this business and this session has not.
CREATE FUNCTION authz.mfa_ok(p_business_id uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
BEGIN
 IF actor IS NULL OR authz.session_level() IN ('aal2', 'system') THEN RETURN true; END IF;  -- no caller: other checks refuse
 RETURN NOT authz.mfa_enrolled(actor) AND NOT authz.mfa_required(p_business_id, actor);
END $$;
REVOKE ALL ON FUNCTION authz.mfa_enrolled(uuid), authz.mfa_required(uuid, uuid), authz.session_level(), authz.mfa_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION authz.mfa_ok(uuid) TO authenticated, cacu_runtime;

-- The shared membership checks refuse a session that still owes the second step.
CREATE OR REPLACE FUNCTION authz.has_permission(p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT authz.mfa_ok(p_business_id) AND authz.has_permission_for(auth.uid(), p_business_id, p_permission, p_location_id);
$$;
-- The shared membership checks keep their live parameter names (CREATE OR REPLACE cannot rename them), so each header
-- is read from the live definition and the bodies use positional parameters. A database without one of them (the
-- reduced test schema) skips it with a notice; production has all of them.
DO $patch$
DECLARE target record; fn regprocedure;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('public.is_business_member(uuid)', 'boolean', 'sql',
    'SELECT EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active) AND authz.mfa_ok($1)'),
   ('public.has_business_role(uuid,public.membership_role[])', 'boolean', 'sql',
    'SELECT EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active AND role = ANY($2)) AND authz.mfa_ok($1)'),
   ('management_private.authorize(uuid,text[],boolean)', 'uuid', 'plpgsql',
    $b$DECLARE actor uuid := auth.uid();
BEGIN
 IF $3 THEN PERFORM pg_advisory_xact_lock(hashtextextended($1::text, 0)); END IF;
 IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id = $1 AND user_id = actor AND is_active AND role::text = ANY($2) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
 IF NOT authz.mfa_ok($1) THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = '42501'; END IF;
 RETURN actor;
END$b$)
 ) AS t(signature, returns, language, body) LOOP
  fn := CASE WHEN to_regtype('public.membership_role') IS NOT NULL OR target.signature NOT LIKE '%membership_role%'
             THEN to_regprocedure(target.signature) END;
  IF fn IS NULL THEN RAISE NOTICE 'two-step sign-in: % not present, skipped', target.signature; CONTINUE; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %s.%I(%s) RETURNS %s LANGUAGE %s %s SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS %L',
   (SELECT nspname FROM pg_namespace n JOIN pg_proc p ON p.pronamespace = n.oid WHERE p.oid = fn),
   (SELECT proname FROM pg_proc WHERE oid = fn), pg_get_function_arguments(fn), target.returns, target.language,
   CASE target.language WHEN 'sql' THEN 'STABLE' ELSE 'VOLATILE' END, target.body);
 END LOOP;
END $patch$;

-- People always see their own memberships, so the app can tell them to finish signing in or to set up the
-- authenticator their plan requires. The businesses themselves stay hidden until then.
CREATE POLICY memberships_select_self ON public.memberships FOR SELECT TO authenticated USING (user_id = auth.uid());

-- What the app shows: whether this session may use the business, and why not.
CREATE FUNCTION public.mfa_status(p_business_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); enrolled boolean; required boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
 enrolled := authz.mfa_enrolled(actor);
 required := authz.mfa_required(p_business_id, actor);
 RETURN jsonb_build_object('enrolled', enrolled, 'required', required, 'level', authz.session_level(),
  'satisfied', authz.session_level() = 'aal2' OR (NOT enrolled AND NOT required),
  'recovery_codes_left', (SELECT count(*) FROM security_private.recovery_code WHERE user_id = actor AND used_at IS NULL));
END $$;

-- Ten new recovery codes, shown once; earlier ones stop working. Only right after the second step.
CREATE FUNCTION public.new_recovery_codes() RETURNS text[]
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); codes text[] := '{}'; code text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
 IF authz.session_level() <> 'aal2' OR NOT authz.mfa_enrolled(actor) THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = '42501'; END IF;
 DELETE FROM security_private.recovery_code WHERE user_id = actor;
 FOR i IN 1..10 LOOP
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  INSERT INTO security_private.recovery_code (user_id, code_hash)
   VALUES (actor, encode(sha256(convert_to(actor::text || ':' || replace(code, '-', ''), 'UTF8')), 'hex'));
  codes := codes || code;
 END LOOP;
 RETURN codes;
END $$;

-- With the password already given, a recovery code removes the person's authenticators so they can set up a new one.
-- Each code works once; five tries an hour.
CREATE FUNCTION public.use_recovery_code(p_code text) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); matched boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501'; END IF;
 IF (SELECT count(*) FROM security_private.recovery_attempt WHERE user_id = actor AND NOT succeeded AND attempted_at > now() - interval '1 hour') >= 5 THEN
  RAISE EXCEPTION 'TOO_MANY_ATTEMPTS' USING ERRCODE = '54000';
 END IF;
 UPDATE security_private.recovery_code SET used_at = now()
  WHERE user_id = actor AND used_at IS NULL AND code_hash = encode(sha256(convert_to(actor::text || ':' || clean, 'UTF8')), 'hex');
 matched := FOUND;
 INSERT INTO security_private.recovery_attempt (user_id, succeeded) VALUES (actor, matched);
 IF matched AND to_regclass('auth.mfa_factors') IS NOT NULL THEN
  DELETE FROM auth.mfa_factors WHERE user_id = actor;
 END IF;
 RETURN matched;
END $$;
REVOKE ALL ON FUNCTION public.mfa_status(uuid), public.new_recovery_codes(), public.use_recovery_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_status(uuid), public.new_recovery_codes(), public.use_recovery_code(text) TO authenticated;
