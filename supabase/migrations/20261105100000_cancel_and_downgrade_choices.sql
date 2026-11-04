-- Cancellation (Doc 14 SUB-11) and choosing who stays on a smaller plan (SUB-06).
-- Cancel: the Owner cancels; access continues to the end of the paid period (or trial), then the subscription is
-- 'cancelled' and the workspace read-only (SUB-10). Nothing is deleted; choosing a plan reopens it (SUB-12). Cancelling
-- stops renewal invoices and card charges, and can be undone until the period ends.
-- Downgrade choices: when the next period is on a smaller plan (a scheduled downgrade, or a trial ending on General),
-- an Owner or Admin picks which users and outlets stay active. When the period ends the rest are deactivated, never
-- deleted, and open invitations beyond the seats are cancelled. Owners always stay. Without a choice, the earliest
-- added stay. Catalogue items are not deactivated; the plan limit only stops new ones (TEST-209).
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE platform.subscriptions ADD COLUMN downgrade_keep jsonb;

-- The smaller plan the next period will be on, if any: a scheduled downgrade, or General after a trial.
CREATE FUNCTION platform.next_smaller_plan(p_business_id uuid) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN s.cancel_at_period_end THEN NULL
             WHEN s.status = 'trialing' THEN (SELECT after_trial_plan FROM platform.settings WHERE id = 1)
             WHEN s.status = 'active' THEN s.scheduled_plan_code END
   FROM platform.subscriptions s WHERE s.business_id = p_business_id;
$$;

CREATE FUNCTION platform.plan_limit(p_plan text, p_key text) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN value::text::integer END
   FROM platform.plan_entitlements WHERE plan_code = p_plan AND key = p_key;
$$;

-- Applies a smaller plan's users and outlets limits: owners first, then the owner's choice, then the earliest added.
CREATE FUNCTION platform.apply_downgrade_keep(p_business_id uuid, p_plan text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE keep jsonb; seats integer := platform.plan_limit(p_plan, 'users.max'); outlets integer := platform.plan_limit(p_plan, 'outlets.max');
BEGIN
 SELECT coalesce(downgrade_keep, '{}'::jsonb) INTO keep FROM platform.subscriptions WHERE business_id = p_business_id;
 IF seats IS NOT NULL THEN
  UPDATE public.memberships m SET is_active = false
   WHERE m.business_id = p_business_id AND m.is_active AND m.role::text <> 'owner'
     AND m.user_id NOT IN (
      SELECT r.user_id FROM public.memberships r WHERE r.business_id = p_business_id AND r.is_active
       ORDER BY (r.role::text = 'owner') DESC, (keep->'users') ? r.user_id::text DESC,
                (to_jsonb(r)->>'created_at')::timestamptz NULLS LAST, r.user_id
       LIMIT seats);
  IF (SELECT count(*) FROM public.memberships WHERE business_id = p_business_id AND is_active) >= seats THEN
   UPDATE public.business_invitations SET status = 'cancelled' WHERE business_id = p_business_id AND status = 'invited';
  END IF;
 END IF;
 IF outlets IS NOT NULL THEN
  UPDATE public.business_locations l SET is_active = false
   WHERE l.business_id = p_business_id AND l.is_active
     AND l.id NOT IN (
      SELECT o.id FROM public.business_locations o WHERE o.business_id = p_business_id AND o.is_active
       ORDER BY (keep->'outlets') ? o.id::text DESC, (to_jsonb(o)->>'created_at')::timestamptz NULLS LAST, o.id
       LIMIT outlets);
 END IF;
END $$;

-- As before, plus: a cancelled trial ends as 'cancelled'; otherwise General applies with the owner's choice of who stays.
CREATE OR REPLACE FUNCTION platform.end_trials(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.settings%ROWTYPE; sub platform.subscriptions%ROWTYPE; changed integer := 0;
BEGIN
 SELECT * INTO s FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true);
 FOR sub IN SELECT * FROM platform.subscriptions WHERE status = 'trialing' AND current_period_end <= p_now FOR UPDATE LOOP
  IF sub.cancel_at_period_end THEN
   PERFORM set_config('platform.reason', 'Trial ended; subscription cancelled by the owner', true);
   UPDATE platform.subscriptions SET status = 'cancelled', grace_ends_at = NULL, downgrade_keep = NULL WHERE business_id = sub.business_id;
  ELSE
   PERFORM set_config('platform.reason', 'Trial ended; first payment due', true);
   PERFORM platform.apply_downgrade_keep(sub.business_id, s.after_trial_plan);
   UPDATE platform.subscriptions SET plan_code = s.after_trial_plan, status = 'incomplete', billing_interval = 'monthly',
          grace_ends_at = current_period_end + make_interval(days => s.grace_days), downgrade_keep = NULL
    WHERE business_id = sub.business_id;
  END IF;
  changed := changed + 1;
 END LOOP;
 RETURN changed;
END $$;

-- As before, plus: a cancelled subscription ends as 'cancelled'; a downgrade applies the choice of who stays.
CREATE OR REPLACE FUNCTION platform.end_periods(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grace integer; sub platform.subscriptions%ROWTYPE; terms record; changed integer := 0;
BEGIN
 SELECT grace_days INTO grace FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true);
 FOR sub IN SELECT * FROM platform.subscriptions WHERE status = 'active' AND current_period_end <= p_now FOR UPDATE LOOP
  IF sub.cancel_at_period_end THEN
   PERFORM set_config('platform.reason', 'Paid period ended; subscription cancelled by the owner', true);
   UPDATE platform.subscriptions SET status = 'cancelled', grace_ends_at = NULL, scheduled_plan_code = NULL,
          scheduled_interval = NULL, downgrade_keep = NULL
    WHERE business_id = sub.business_id;
  ELSE
   PERFORM set_config('platform.reason', 'Paid period ended; renewal due', true);
   SELECT * INTO terms FROM platform.next_period_terms(sub);
   IF terms.plan_code <> sub.plan_code THEN PERFORM platform.apply_downgrade_keep(sub.business_id, terms.plan_code); END IF;
   UPDATE platform.subscriptions SET plan_code = terms.plan_code, billing_interval = terms.billing_interval, status = 'past_due',
          grace_ends_at = sub.current_period_end + make_interval(days => grace), scheduled_plan_code = NULL,
          scheduled_interval = NULL, downgrade_keep = NULL
    WHERE business_id = sub.business_id;
  END IF;
  changed := changed + 1;
 END LOOP;
 RETURN changed;
END $$;

-- As before, but a subscription that will be cancelled gets no renewal invoice.
CREATE OR REPLACE FUNCTION platform.issue_renewals(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; terms record; price bigint; owner uuid; billed record; issued integer := 0;
BEGIN
 FOR sub IN SELECT s.* FROM platform.subscriptions s
             WHERE s.status = 'active' AND NOT s.cancel_at_period_end AND s.current_period_end <= p_now + interval '3 days'
               AND NOT EXISTS (SELECT FROM platform.invoices i WHERE i.business_id = s.business_id AND i.kind = 'renewal'
                                AND i.period_start = s.current_period_end AND i.status <> 'void')
             FOR UPDATE OF s LOOP
  SELECT * INTO terms FROM platform.next_period_terms(sub);
  price := platform.plan_price(terms.plan_code, terms.billing_interval);
  SELECT user_id INTO owner FROM public.memberships WHERE business_id = sub.business_id AND role::text = 'owner' AND is_active LIMIT 1;
  CONTINUE WHEN owner IS NULL OR price IS NULL;
  SELECT * INTO billed FROM platform.with_vat(price);
  INSERT INTO platform.invoices(business_id, request_key, plan_code, billing_interval, subtotal_kobo, vat_rate_bps, vat_kobo,
                                total_kobo, reference, created_by, kind, period_start)
  VALUES (sub.business_id, gen_random_uuid(), terms.plan_code, terms.billing_interval, billed.subtotal, billed.rate, billed.vat,
          billed.subtotal + billed.vat, 'CACU-SUB-' || replace(gen_random_uuid()::text, '-', ''), owner, 'renewal', sub.current_period_end);
  issued := issued + 1;
 END LOOP;
 RETURN issued;
END $$;

-- SUB-11: only the Owner cancels, or takes the cancellation back before the period ends.
CREATE FUNCTION public.cancel_subscription(p_business_id uuid, p_cancel boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); sub platform.subscriptions%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = actor AND is_active
                                  AND role::text = 'owner') THEN
  RAISE EXCEPTION 'BILLING_OWNER_REQUIRED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO sub FROM platform.subscriptions WHERE business_id = p_business_id FOR UPDATE;
 IF NOT FOUND OR sub.status NOT IN ('active', 'trialing') THEN RAISE EXCEPTION 'BILLING_CANCEL_NEEDS_ACTIVE_PLAN' USING ERRCODE = 'P0001'; END IF;
 IF sub.cancel_at_period_end IS DISTINCT FROM coalesce(p_cancel, false) THEN
  PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', actor::text, true),
          set_config('platform.reason', CASE WHEN p_cancel THEN 'Cancelled by the owner; access continues to the end of the period'
                                             ELSE 'Cancellation taken back by the owner' END, true);
  UPDATE platform.subscriptions SET cancel_at_period_end = coalesce(p_cancel, false), downgrade_keep = NULL
   WHERE business_id = p_business_id RETURNING * INTO sub;
  PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
  -- No renewal will be charged for a period that is not coming; taking it back lets the next run reissue one.
  IF p_cancel THEN
   UPDATE platform.invoices SET status = 'void' WHERE business_id = p_business_id AND kind = 'renewal' AND status = 'open';
  END IF;
 END IF;
 RETURN jsonb_build_object('cancel_at_period_end', sub.cancel_at_period_end, 'ends_at', sub.current_period_end);
END $$;

-- SUB-06: who stays on the smaller plan. Owners and Admins only; owners always stay and count towards the seats.
CREATE FUNCTION public.downgrade_choices(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target text; keep jsonb;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 target := platform.next_smaller_plan(p_business_id);
 IF target IS NULL THEN RETURN jsonb_build_object('plan', NULL); END IF;
 SELECT coalesce(downgrade_keep, '{}'::jsonb) INTO keep FROM platform.subscriptions WHERE business_id = p_business_id;
 RETURN jsonb_build_object('plan', target, 'plan_name', (SELECT display_name FROM platform.plans WHERE code = target),
  'seats', platform.plan_limit(target, 'users.max'), 'outlets_limit', platform.plan_limit(target, 'outlets.max'),
  'chosen', keep ? 'users' OR keep ? 'outlets',
  'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', to_jsonb(m)->>'display_name', 'email', u.email,
               'role', m.role, 'keep', m.role::text = 'owner' OR coalesce((keep->'users') ? m.user_id::text, false))
               ORDER BY (m.role::text = 'owner') DESC, to_jsonb(m)->>'created_at', m.user_id), '[]'::jsonb)
              FROM public.memberships m LEFT JOIN auth.users u ON u.id = m.user_id WHERE m.business_id = p_business_id AND m.is_active),
  'outlets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', to_jsonb(l)->>'name',
               'keep', coalesce((keep->'outlets') ? l.id::text, false)) ORDER BY to_jsonb(l)->>'created_at', l.id), '[]'::jsonb)
              FROM public.business_locations l WHERE l.business_id = p_business_id AND l.is_active));
END $$;

CREATE FUNCTION public.save_downgrade_choices(p_business_id uuid, p_users uuid[], p_outlets uuid[]) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); target text; seats integer; outlets integer; kept_users integer; users uuid[] := coalesce(p_users, '{}');
 places uuid[] := coalesce(p_outlets, '{}');
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = actor AND is_active
                                  AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 PERFORM 1 FROM platform.subscriptions WHERE business_id = p_business_id FOR UPDATE;
 target := platform.next_smaller_plan(p_business_id);
 IF target IS NULL THEN RAISE EXCEPTION 'BILLING_NO_DOWNGRADE_SCHEDULED' USING ERRCODE = 'P0001'; END IF;
 IF EXISTS (SELECT FROM unnest(users) u(id) WHERE NOT EXISTS (SELECT FROM public.memberships m WHERE m.business_id = p_business_id
            AND m.user_id = u.id AND m.is_active))
    OR EXISTS (SELECT FROM unnest(places) o(id) WHERE NOT EXISTS (SELECT FROM public.business_locations l WHERE l.business_id = p_business_id
            AND l.id = o.id AND l.is_active)) THEN
  RAISE EXCEPTION 'BILLING_KEEP_NOT_IN_BUSINESS' USING ERRCODE = '22023';
 END IF;
 seats := platform.plan_limit(target, 'users.max'); outlets := platform.plan_limit(target, 'outlets.max');
 SELECT count(*) INTO kept_users FROM public.memberships m
  WHERE m.business_id = p_business_id AND m.is_active AND (m.role::text = 'owner' OR m.user_id = ANY (users));
 IF seats IS NOT NULL AND kept_users > seats THEN RAISE EXCEPTION 'PLAN_LIMIT users.max' USING ERRCODE = 'P0001'; END IF;
 IF outlets IS NOT NULL AND cardinality(ARRAY(SELECT DISTINCT unnest(places))) > outlets THEN
  RAISE EXCEPTION 'PLAN_LIMIT outlets.max' USING ERRCODE = 'P0001';
 END IF;
 PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', actor::text, true),
         set_config('platform.reason', 'Chose who stays on the ' || (SELECT display_name FROM platform.plans WHERE code = target) || ' Plan', true);
 UPDATE platform.subscriptions SET downgrade_keep = jsonb_build_object('users', to_jsonb(users), 'outlets', to_jsonb(places))
  WHERE business_id = p_business_id;
 PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
 RETURN public.downgrade_choices(p_business_id);
END $$;

-- A different scheduled plan makes an earlier choice of who stays meaningless; clear it.
CREATE FUNCTION platform.clear_downgrade_keep() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 NEW.downgrade_keep := NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_clear_downgrade_keep BEFORE UPDATE OF scheduled_plan_code ON platform.subscriptions FOR EACH ROW
 WHEN (NEW.scheduled_plan_code IS DISTINCT FROM OLD.scheduled_plan_code) EXECUTE FUNCTION platform.clear_downgrade_keep();

REVOKE ALL ON FUNCTION platform.next_smaller_plan(uuid), platform.plan_limit(text, text), platform.apply_downgrade_keep(uuid, text),
 platform.clear_downgrade_keep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_subscription(uuid, boolean), public.downgrade_choices(uuid), public.save_downgrade_choices(uuid, uuid[], uuid[])
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid, boolean), public.downgrade_choices(uuid), public.save_downgrade_choices(uuid, uuid[], uuid[])
 TO authenticated;
