-- Plan limits on users, outlets and catalogue items (Doc 14 TEST-209). Checked by triggers on the tables themselves,
-- so the browser, the accounting API and direct Data API writes all meet the same limit. Only new or reactivated
-- rows are refused: after a downgrade everything already there stays usable, and nothing is deactivated for the owner.
-- Unbilled businesses (no subscription) and JSON null (unlimited) are not limited.
SET LOCAL search_path = public, pg_catalog;

-- What a business uses against each counted limit. A seat is an active member or an invitation still open, so an
-- owner cannot invite past the limit and have the invitations accepted later.
CREATE FUNCTION platform.usage_count(p_business_id uuid, p_key text) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE p_key
  WHEN 'users.max' THEN
   (SELECT count(*) FROM public.memberships WHERE business_id = p_business_id AND is_active)
   + (SELECT count(*) FROM public.business_invitations WHERE business_id = p_business_id AND status = 'invited' AND expires_at > now())
  WHEN 'outlets.max' THEN (SELECT count(*) FROM public.business_locations WHERE business_id = p_business_id AND is_active)
  WHEN 'catalog.max_items' THEN (SELECT count(*) FROM public.catalog_items WHERE business_id = p_business_id AND coalesce(is_active, true))
 END::integer;
$$;

-- Refuses one more unit of p_key when p_used already reaches the plan's limit.
CREATE FUNCTION platform.require_room(p_business_id uuid, p_key text, p_used integer) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE limit_value jsonb := platform.entitlement(p_business_id, p_key);
BEGIN
 IF limit_value IS NULL OR jsonb_typeof(limit_value) <> 'number' THEN RETURN; END IF;
 IF p_used >= limit_value::text::integer THEN
  RAISE EXCEPTION 'PLAN_LIMIT %', p_key USING ERRCODE = 'P0001',
   DETAIL = format('The plan allows %s; %s already in use', limit_value, p_used);
 END IF;
END $$;

CREATE FUNCTION platform.plan_limit_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE used integer;
BEGIN
 IF TG_TABLE_NAME = 'business_invitations' THEN
  -- A new invitation, or a resend that reopens an expired one.
  IF NEW.status <> 'invited' OR (TG_OP = 'UPDATE' AND (OLD.status <> 'invited' OR OLD.expires_at > now() OR NEW.expires_at <= now())) THEN
   RETURN NEW;
  END IF;
 ELSIF NOT coalesce(NEW.is_active, true) OR (TG_OP = 'UPDATE' AND coalesce(OLD.is_active, true)) THEN
  RETURN NEW;
 END IF;
 -- The same per-business lock management writes and invitation acceptance take, so two writes cannot both
 -- take the last place.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text, 0));
 IF TG_TABLE_NAME = 'memberships' AND TG_OP = 'INSERT' THEN
  -- Accepting an invitation fills the seat that invitation already held, so only members count here.
  SELECT count(*) INTO used FROM public.memberships WHERE business_id = NEW.business_id AND is_active;
  PERFORM platform.require_room(NEW.business_id, 'users.max', used);
 ELSE
  PERFORM platform.require_room(NEW.business_id, TG_ARGV[0], platform.usage_count(NEW.business_id, TG_ARGV[0]));
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER memberships_plan_limit BEFORE INSERT OR UPDATE OF is_active ON public.memberships
 FOR EACH ROW EXECUTE FUNCTION platform.plan_limit_guard('users.max');
CREATE TRIGGER business_invitations_plan_limit BEFORE INSERT OR UPDATE OF status, expires_at ON public.business_invitations
 FOR EACH ROW EXECUTE FUNCTION platform.plan_limit_guard('users.max');
CREATE TRIGGER business_locations_plan_limit BEFORE INSERT OR UPDATE OF is_active ON public.business_locations
 FOR EACH ROW EXECUTE FUNCTION platform.plan_limit_guard('outlets.max');
CREATE TRIGGER catalog_items_plan_limit BEFORE INSERT OR UPDATE OF is_active ON public.catalog_items
 FOR EACH ROW EXECUTE FUNCTION platform.plan_limit_guard('catalog.max_items');

REVOKE ALL ON FUNCTION platform.usage_count(uuid, text), platform.require_room(uuid, text, integer), platform.plan_limit_guard()
 FROM PUBLIC, anon, authenticated;

-- The plan a member sees now includes what the business uses against each counted limit.
CREATE OR REPLACE FUNCTION public.business_plan(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.subscriptions%ROWTYPE; p platform.plans%ROWTYPE;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO s FROM platform.subscriptions WHERE business_id = p_business_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('subscribed', false); END IF;
 SELECT * INTO p FROM platform.plans WHERE code = s.plan_code;
 RETURN jsonb_build_object('subscribed', true, 'plan', p.code, 'plan_name', p.display_name, 'status', s.status,
  'billing_interval', s.billing_interval, 'current_period_end', s.current_period_end, 'grace_ends_at', s.grace_ends_at,
  'scheduled_plan', s.scheduled_plan_code, 'cancel_at_period_end', s.cancel_at_period_end,
  'writes_allowed', platform.writes_allowed(p_business_id),
  'entitlements', (SELECT jsonb_object_agg(e.key, e.value) FROM platform.plan_entitlements e WHERE e.plan_code = s.plan_code),
  'usage', (SELECT jsonb_object_agg(k, platform.usage_count(p_business_id, k))
             FROM unnest(ARRAY['users.max', 'outlets.max', 'catalog.max_items']) k));
END $$;
