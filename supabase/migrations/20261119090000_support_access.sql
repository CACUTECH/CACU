-- Support access (Doc 10 E22 part 4; FR-212; Doc 08 THR-08 and §4 "platform staff"; Doc 16 T-12; Doc 07 ops schema;
-- Doc 17 RB-09). Owner decisions of 13 November 2026:
--  * CACU staff have no standing access to any business. The Owner grants it for one support case, for 1 hour,
--    24 hours, 3 days or 7 days, with a reason, and can end it early. There is no open-ended window;
--  * support access is read-only;
--  * staff and pay records (the HR module) are included only when the Owner ticks it for that grant.
-- How it works:
--  * CACU's support people are listed in ops.support_staff by the operator (runbook RB-09). Only they can use a grant,
--    and only after the second sign-in step (aal2);
--  * a support person must open the case first; opening is recorded, and only then do the shared view checks
--    (is_business_member, has_business_role with viewer, authz.has_permission for *.view, the accounting API's
--    membership checks) let them read the business;
--  * nothing that writes accepts it: write permissions and write roles never match a support case, the accounting API
--    refuses support on every write, and a trigger on every business table refuses any row change made by a CACU
--    support account in a business it is not a member of;
--  * the Owner sees every grant and every opening, by whom and when.
SET LOCAL search_path = public, pg_catalog;

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;

-- CACU's support people. Maintained by the operator only.
CREATE TABLE ops.support_staff (
 user_id uuid PRIMARY KEY,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 active boolean NOT NULL DEFAULT true,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz
);

-- One grant per support case. At most one active at a time per business.
CREATE TABLE ops.support_grant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 granted_by uuid NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
 include_pay boolean NOT NULL DEFAULT false,
 granted_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 ended_by uuid,
 CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '7 days'),
 CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE INDEX support_grant_business ON ops.support_grant (business_id, granted_at DESC);
CREATE INDEX support_grant_live ON ops.support_grant (expires_at) WHERE ended_at IS NULL;

-- Who opened which case. Reading needs an opening.
CREATE TABLE ops.support_opening (
 grant_id uuid NOT NULL REFERENCES ops.support_grant(id),
 user_id uuid NOT NULL REFERENCES ops.support_staff(user_id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (grant_id, user_id)
);

-- The record the Owner sees: granted, opened, ended. Append-only.
CREATE TABLE ops.support_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 grant_id uuid NOT NULL REFERENCES ops.support_grant(id),
 event text NOT NULL CHECK (event IN ('granted', 'opened', 'ended')),
 actor_id uuid NOT NULL,
 at timestamptz NOT NULL DEFAULT now(),
 details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX support_event_business ON ops.support_event (business_id, at DESC);

CREATE FUNCTION ops.support_event_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'SUPPORT_EVENTS_APPEND_ONLY' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER support_event_append_only BEFORE UPDATE OR DELETE ON ops.support_event
 FOR EACH ROW EXECUTE FUNCTION ops.support_event_append_only();
REVOKE ALL ON FUNCTION ops.support_event_append_only() FROM PUBLIC;

ALTER TABLE ops.support_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.support_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.support_opening ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.support_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.support_staff, ops.support_grant, ops.support_opening, ops.support_event FROM PUBLIC, anon, authenticated;

-- The signed-in caller, from the request claims.
CREATE FUNCTION authz.caller() RETURNS uuid
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

-- The caller's live, opened support case for the business, if any: an active CACU support person, after the second
-- step, who opened an unexpired grant that the Owner has not ended. NULL otherwise.
CREATE FUNCTION authz.support_case(p_business_id uuid) RETURNS ops.support_grant
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT g FROM ops.support_grant g
  JOIN ops.support_opening o ON o.grant_id = g.id
  JOIN ops.support_staff s ON s.user_id = o.user_id AND s.active
  WHERE g.business_id = p_business_id AND o.user_id = authz.caller() AND g.ended_at IS NULL AND g.expires_at > now()
    AND authz.session_level() = 'aal2'
  LIMIT 1;
$$;

CREATE FUNCTION authz.supporting(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT p_business_id IS NOT NULL AND (authz.support_case(p_business_id)).id IS NOT NULL;
$$;

-- What a support case may read: view permissions only; HR (staff and pay) only when the Owner ticked it.
CREATE FUNCTION authz.support_permits(p_business_id uuid, p_permission text) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g ops.support_grant;
BEGIN
 IF p_permission IS NULL OR p_permission NOT LIKE '%.view' THEN RETURN false; END IF;
 g := authz.support_case(p_business_id);
 IF g.id IS NULL THEN RETURN false; END IF;
 IF split_part(p_permission, '.', 1) = 'hr' AND NOT g.include_pay THEN RETURN false; END IF;
 RETURN authz.plan_allows(p_business_id, split_part(p_permission, '.', 1));
END $$;

-- A CACU support account never changes a business it is not a member of.
CREATE FUNCTION authz.support_read_only() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := authz.caller(); b uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT FROM ops.support_staff WHERE user_id = actor) THEN
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP = 'DELETE' THEN b := OLD.business_id; ELSE b := NEW.business_id; END IF;
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = b AND user_id = actor AND is_active) THEN
  RAISE EXCEPTION 'SUPPORT_READ_ONLY' USING ERRCODE = '42501', HINT = 'CACU support access is read-only';
 END IF;
 RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

REVOKE ALL ON FUNCTION authz.caller(), authz.support_case(uuid), authz.supporting(uuid), authz.support_permits(uuid, text),
 authz.support_read_only() FROM PUBLIC, anon, authenticated;
-- accounting.authorized runs as the API's role, so the API needs the yes/no check.
GRANT EXECUTE ON FUNCTION authz.supporting(uuid) TO cacu_runtime;

DO $guard$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.oid::regclass AS rel, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype) LOOP
  EXECUTE format('CREATE TRIGGER support_read_only BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION authz.support_read_only()', t.rel);
 END LOOP;
END $guard$;

-- The shared view checks accept an opened support case.
CREATE OR REPLACE FUNCTION authz.has_permission(p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT (authz.mfa_ok(p_business_id) AND authz.has_permission_for(auth.uid(), p_business_id, p_permission, p_location_id))
     OR authz.support_permits(p_business_id, p_permission);
$$;

-- As in two-step sign-in: each header is read from the live definition (parameter names differ between databases) and
-- the bodies use positional parameters. A database without one of them (the reduced test schema) skips it.
-- membership patch begin
DO $patch$
DECLARE target record; fn regprocedure;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('public.is_business_member(uuid)',
    'SELECT (EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active) AND authz.mfa_ok($1)) OR authz.supporting($1)'),
   -- Read-only: only checks that admit viewers admit a support case.
   ('public.has_business_role(uuid,public.membership_role[])',
    'SELECT (EXISTS (SELECT 1 FROM public.memberships WHERE business_id = $1 AND user_id = auth.uid() AND is_active AND role = ANY($2)) AND authz.mfa_ok($1)) OR (''viewer'' = ANY($2::text[]) AND authz.supporting($1))')
 ) AS t(signature, body) LOOP
  fn := CASE WHEN to_regtype('public.membership_role') IS NOT NULL OR target.signature NOT LIKE '%membership_role%'
             THEN to_regprocedure(target.signature) END;
  IF fn IS NULL THEN RAISE NOTICE 'support access: % not present, skipped', target.signature; CONTINUE; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION %s.%I(%s) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS %L',
   (SELECT nspname FROM pg_namespace n JOIN pg_proc p ON p.pronamespace = n.oid WHERE p.oid = fn),
   (SELECT proname FROM pg_proc WHERE oid = fn), pg_get_function_arguments(fn), target.body);
 END LOOP;
END $patch$;
-- membership patch end

-- The accounting API: its tables show a support case the business's rows, and its membership check names it 'support'
-- (the API refuses 'support' on every write).
-- support api begin
CREATE OR REPLACE FUNCTION accounting.authorized(tenant uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
 SELECT tenant = nullif(current_setting('cacu.business_id', true), '')::uuid
  AND (EXISTS (SELECT 1 FROM public.memberships m WHERE m.business_id = tenant AND m.is_active
               AND m.user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid)
       OR authz.supporting(tenant));
$$;
CREATE OR REPLACE FUNCTION accounting.lock_membership(tenant uuid, actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result text;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id', true), '')::uuid
 OR actor IS DISTINCT FROM (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid THEN
   RAISE EXCEPTION 'invalid membership scope' USING ERRCODE = '42501';
 END IF;
 SELECT role::text INTO result FROM public.memberships
 WHERE business_id = tenant AND user_id = actor AND is_active FOR SHARE;
 IF result IS NULL AND authz.supporting(tenant) THEN result := 'support'; END IF;
 RETURN result;
END $$;
-- support api end

-- What the Owner sees: the live grant, if any, and the record of grants, openings and endings.
CREATE FUNCTION public.support_access_status(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g ops.support_grant;
BEGIN
 PERFORM management_private.authorize(p_business_id, ARRAY['owner'], false);
 SELECT * INTO g FROM ops.support_grant WHERE business_id = p_business_id AND ended_at IS NULL AND expires_at > now()
  ORDER BY granted_at DESC LIMIT 1;
 RETURN jsonb_build_object(
  'active', CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('id', g.id, 'reason', g.reason, 'include_pay', g.include_pay,
             'granted_at', g.granted_at, 'expires_at', g.expires_at) END,
  'history', coalesce((SELECT jsonb_agg(jsonb_build_object('event', e.event, 'at', e.at, 'reason', g2.reason, 'include_pay', g2.include_pay,
             'expires_at', g2.expires_at, 'by', CASE WHEN e.event = 'opened' THEN coalesce(s.name, 'CACU support') ELSE 'Owner' END) ORDER BY e.at DESC)
             FROM (SELECT * FROM ops.support_event WHERE business_id = p_business_id ORDER BY at DESC LIMIT 50) e
             JOIN ops.support_grant g2 ON g2.id = e.grant_id
             LEFT JOIN ops.support_staff s ON s.user_id = e.actor_id), '[]'::jsonb));
END $$;

-- The Owner grants access for one support case.
CREATE FUNCTION public.grant_support_access(p_business_id uuid, p_hours integer, p_reason text, p_include_pay boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; g ops.support_grant;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner'], true);
 IF p_hours IS NULL OR p_hours NOT IN (1, 24, 72, 168) THEN RAISE EXCEPTION 'SUPPORT_LENGTH_INVALID' USING ERRCODE = '22023'; END IF;
 IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT FROM ops.support_grant WHERE business_id = p_business_id AND ended_at IS NULL AND expires_at > now()) THEN
  RAISE EXCEPTION 'SUPPORT_ALREADY_GRANTED' USING ERRCODE = '23514';
 END IF;
 INSERT INTO ops.support_grant (business_id, granted_by, reason, include_pay, expires_at)
  VALUES (p_business_id, actor, btrim(p_reason), coalesce(p_include_pay, false), now() + make_interval(hours => p_hours))
  RETURNING * INTO g;
 INSERT INTO ops.support_event (business_id, grant_id, event, actor_id, details)
  VALUES (p_business_id, g.id, 'granted', actor, jsonb_build_object('hours', p_hours, 'include_pay', g.include_pay));
 RETURN public.support_access_status(p_business_id);
END $$;

-- The Owner ends it early. Support loses access at once.
CREATE FUNCTION public.end_support_access(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; ended uuid;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner'], true);
 UPDATE ops.support_grant SET ended_at = now(), ended_by = actor
  WHERE business_id = p_business_id AND ended_at IS NULL AND expires_at > now() RETURNING id INTO ended;
 IF ended IS NULL THEN RAISE EXCEPTION 'NO_SUPPORT_ACCESS' USING ERRCODE = '23514'; END IF;
 INSERT INTO ops.support_event (business_id, grant_id, event, actor_id) VALUES (p_business_id, ended, 'ended', actor);
 RETURN public.support_access_status(p_business_id);
END $$;

-- What a CACU support person sees: the businesses that have granted access now. Nobody else sees anything.
CREATE FUNCTION public.support_cases() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT FROM ops.support_staff WHERE user_id = actor AND active) THEN
  RETURN jsonb_build_object('staff', false, 'two_step', false, 'cases', '[]'::jsonb);
 END IF;
 IF authz.session_level() <> 'aal2' THEN
  RETURN jsonb_build_object('staff', true, 'two_step', false, 'cases', '[]'::jsonb);
 END IF;
 RETURN jsonb_build_object('staff', true, 'two_step', true, 'cases', coalesce((
  SELECT jsonb_agg(jsonb_build_object('business_id', g.business_id, 'name', b.name, 'reason', g.reason, 'include_pay', g.include_pay,
          'expires_at', g.expires_at, 'opened', EXISTS (SELECT FROM ops.support_opening o WHERE o.grant_id = g.id AND o.user_id = actor))
          ORDER BY g.expires_at)
   FROM ops.support_grant g JOIN public.businesses b ON b.id = g.business_id
   WHERE g.ended_at IS NULL AND g.expires_at > now()), '[]'::jsonb));
END $$;

-- A support person opens a case. Recorded every time.
CREATE FUNCTION public.open_support_case(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); g ops.support_grant;
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT FROM ops.support_staff WHERE user_id = actor AND active) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 IF authz.session_level() <> 'aal2' THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE = '42501'; END IF;
 SELECT * INTO g FROM ops.support_grant WHERE business_id = p_business_id AND ended_at IS NULL AND expires_at > now()
  ORDER BY granted_at DESC LIMIT 1 FOR SHARE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'NO_SUPPORT_ACCESS' USING ERRCODE = '42501'; END IF;
 INSERT INTO ops.support_opening (grant_id, user_id) VALUES (g.id, actor) ON CONFLICT DO NOTHING;
 INSERT INTO ops.support_event (business_id, grant_id, event, actor_id) VALUES (p_business_id, g.id, 'opened', actor);
 RETURN jsonb_build_object('business_id', p_business_id, 'expires_at', g.expires_at, 'include_pay', g.include_pay);
END $$;

REVOKE ALL ON FUNCTION public.support_access_status(uuid), public.grant_support_access(uuid, integer, text, boolean),
 public.end_support_access(uuid), public.support_cases(), public.open_support_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_status(uuid), public.grant_support_access(uuid, integer, text, boolean),
 public.end_support_access(uuid), public.support_cases(), public.open_support_case(uuid) TO authenticated;

-- The operator adds or removes a support person (runbook RB-09). Runtime only.
CREATE FUNCTION ops.set_support_staff(p_user_id uuid, p_name text, p_active boolean) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'USER_REQUIRED' USING ERRCODE = '22023'; END IF;
 INSERT INTO ops.support_staff (user_id, name, active, removed_at)
  VALUES (p_user_id, btrim(coalesce(p_name, 'CACU support')), p_active, CASE WHEN p_active THEN NULL ELSE now() END)
  ON CONFLICT (user_id) DO UPDATE SET name = coalesce(nullif(btrim(p_name), ''), ops.support_staff.name), active = EXCLUDED.active,
   removed_at = CASE WHEN EXCLUDED.active THEN NULL ELSE now() END;
 RETURN (SELECT jsonb_build_object('active_staff', count(*)) FROM ops.support_staff WHERE active);
END $$;
REVOKE ALL ON FUNCTION ops.set_support_staff(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ops TO cacu_runtime;
GRANT EXECUTE ON FUNCTION ops.set_support_staff(uuid, text, boolean) TO cacu_runtime;
