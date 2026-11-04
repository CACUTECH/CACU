-- Monthly and yearly switches (Doc 14 SUB-07) and the price shown before payment (SUB-R05).
-- Monthly to yearly is paid now, like an upgrade: the year's price less the unused value of the current month,
-- and the year starts on payment. Yearly to monthly waits for the end of the annual term, alone or with a
-- downgrade. Every change paid mid-period can be quoted first, from the same calculation checkout uses.
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE platform.subscriptions ADD COLUMN scheduled_interval text CHECK (scheduled_interval IN ('monthly', 'annual'));

-- What choosing (plan, interval) now would charge. Raises the same refusals checkout gives. For an active
-- subscription: a bigger plan on the same interval is the prorated difference (SUB-05); monthly to yearly is the
-- yearly price less the unused value of the current period (SUB-07). Amounts in kobo, rounded to the naira.
CREATE FUNCTION platform.change_charge(p_business_id uuid, p_plan text, p_interval text, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; price bigint; current_price bigint; charge bigint; credit bigint;
 new_rank smallint; current_rank smallint; share numeric; switching boolean; billed record;
BEGIN
 SELECT * INTO sub FROM platform.subscriptions WHERE business_id = p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_NO_SUBSCRIPTION' USING ERRCODE = 'P0001'; END IF;
 price := platform.plan_price(p_plan, p_interval);
 IF price IS NULL THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
 IF NOT platform.mode_allowed(p_business_id, p_plan) THEN RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001'; END IF;
 IF sub.status <> 'active' THEN
  SELECT * INTO billed FROM platform.with_vat(price);
  RETURN jsonb_build_object('kind', 'subscription', 'subtotal_kobo', billed.subtotal, 'vat_kobo', billed.vat,
   'total_kobo', billed.subtotal + billed.vat, 'credit_kobo', NULL, 'period_end', NULL);
 END IF;
 SELECT rank INTO new_rank FROM platform.plans WHERE code = p_plan;
 SELECT rank INTO current_rank FROM platform.plans WHERE code = sub.plan_code;
 switching := p_interval = 'annual' AND sub.billing_interval = 'monthly';
 IF NOT switching THEN
  IF p_interval <> sub.billing_interval THEN RAISE EXCEPTION 'BILLING_INTERVAL_CHANGES_AT_RENEWAL' USING ERRCODE = 'P0001'; END IF;
  IF new_rank = current_rank THEN RAISE EXCEPTION 'BILLING_ALREADY_ON_PLAN' USING ERRCODE = 'P0001'; END IF;
 END IF;
 IF new_rank < current_rank THEN RAISE EXCEPTION 'BILLING_DOWNGRADE_IS_SCHEDULED' USING ERRCODE = 'P0001'; END IF;
 IF sub.current_period_end - p_now < interval '1 day' THEN RAISE EXCEPTION 'BILLING_RENEW_FIRST' USING ERRCODE = 'P0001'; END IF;
 current_price := platform.plan_price(sub.plan_code, sub.billing_interval);
 share := extract(epoch FROM sub.current_period_end - p_now) / extract(epoch FROM sub.current_period_end - sub.current_period_start);
 IF switching THEN
  credit := round(current_price * share / 100) * 100;
  charge := price - credit;
 ELSE
  charge := round((price - current_price) * share / 100) * 100;
 END IF;
 IF charge <= 0 THEN RAISE EXCEPTION 'BILLING_RENEW_FIRST' USING ERRCODE = 'P0001'; END IF;
 SELECT * INTO billed FROM platform.with_vat(charge);
 RETURN jsonb_build_object('kind', 'upgrade', 'subtotal_kobo', billed.subtotal, 'vat_kobo', billed.vat,
  'total_kobo', billed.subtotal + billed.vat, 'credit_kobo', credit, 'period_end', sub.current_period_end);
END $$;

CREATE OR REPLACE FUNCTION platform.open_checkout(p_business_id uuid, p_actor uuid, p_request_key uuid, p_plan text, p_interval text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; inv platform.invoices%ROWTYPE; email text; quote jsonb;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'BILLING_OWNER_OR_ADMIN_REQUIRED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO sub FROM platform.subscriptions WHERE business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_NO_SUBSCRIPTION' USING ERRCODE = 'P0001'; END IF;
 SELECT * INTO inv FROM platform.invoices WHERE business_id = p_business_id AND request_key = p_request_key;
 IF FOUND THEN
  IF inv.plan_code <> p_plan OR inv.billing_interval <> p_interval THEN
   RAISE EXCEPTION 'BILLING_REQUEST_KEY_REUSED' USING ERRCODE = 'P0001';
  END IF;
 ELSE
  quote := platform.change_charge(p_business_id, p_plan, p_interval);
  INSERT INTO platform.invoices(business_id, request_key, plan_code, billing_interval, subtotal_kobo, vat_rate_bps, vat_kobo,
                                total_kobo, reference, created_by, kind, period_end)
  VALUES (p_business_id, p_request_key, p_plan, p_interval, (quote->>'subtotal_kobo')::bigint,
          (SELECT CASE WHEN vat_registered THEN vat_rate_bps ELSE 0 END FROM platform.settings WHERE id = 1),
          (quote->>'vat_kobo')::bigint, (quote->>'total_kobo')::bigint,
          'CACU-SUB-' || replace(gen_random_uuid()::text, '-', ''), p_actor, quote->>'kind', (quote->>'period_end')::timestamptz)
  RETURNING * INTO inv;
 END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id = p_actor;
 RETURN jsonb_build_object('invoice', inv.number, 'reference', inv.reference, 'plan', inv.plan_code, 'kind', inv.kind,
  'billing_interval', inv.billing_interval, 'subtotal_kobo', inv.subtotal_kobo, 'vat_kobo', inv.vat_kobo,
  'total_kobo', inv.total_kobo, 'currency', inv.currency, 'status', inv.status, 'authorization_url', inv.authorization_url,
  'email', email, 'period_end', inv.period_end);
END $$;

-- SUB-R05: the owner sees the exact amount before going to Paystack. Same calculation as checkout.
CREATE FUNCTION public.billing_quote(p_business_id uuid, p_plan text, p_interval text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 RETURN platform.change_charge(p_business_id, p_plan, p_interval);
END $$;

-- SUB-06 and SUB-07: a smaller plan, a switch from yearly to monthly, or both, wait for the end of the period.
-- Choosing the current plan and interval cancels a scheduled change.
DROP FUNCTION platform.schedule_plan_change(uuid, uuid, text);
CREATE FUNCTION platform.schedule_plan_change(p_business_id uuid, p_actor uuid, p_plan text, p_interval text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; target platform.plans%ROWTYPE; current_rank smallint; over jsonb; next_interval text;
 cancelling boolean;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'BILLING_OWNER_OR_ADMIN_REQUIRED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO sub FROM platform.subscriptions WHERE business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_NO_SUBSCRIPTION' USING ERRCODE = 'P0001'; END IF;
 IF sub.status <> 'active' THEN RAISE EXCEPTION 'BILLING_SCHEDULE_NEEDS_ACTIVE_PLAN' USING ERRCODE = 'P0001'; END IF;
 -- Without an interval, keep the current one where the plan offers it (General is monthly only).
 next_interval := coalesce(p_interval, CASE WHEN platform.plan_price(p_plan, sub.billing_interval) IS NULL THEN 'monthly' ELSE sub.billing_interval END);
 SELECT * INTO target FROM platform.plans WHERE code = p_plan AND active;
 IF NOT FOUND OR platform.plan_price(p_plan, next_interval) IS NULL THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT rank INTO current_rank FROM platform.plans WHERE code = sub.plan_code;
 cancelling := p_plan = sub.plan_code AND next_interval = sub.billing_interval;
 IF target.rank > current_rank OR (target.rank = current_rank AND next_interval = 'annual' AND sub.billing_interval = 'monthly') THEN
  RAISE EXCEPTION 'BILLING_UPGRADE_NEEDS_CHECKOUT' USING ERRCODE = 'P0001';
 END IF;
 IF target.rank < current_rank AND NOT platform.mode_allowed(p_business_id, p_plan) THEN
  RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001';
 END IF;
 PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', p_actor::text, true),
         set_config('platform.reason', CASE WHEN cancelling THEN 'Scheduled plan change cancelled'
          WHEN target.rank = current_rank THEN 'Switch to ' || CASE next_interval WHEN 'annual' THEN 'yearly' ELSE 'monthly' END || ' billing scheduled for the end of the period'
          ELSE 'Downgrade to ' || target.display_name || ' scheduled for the end of the period' END, true);
 UPDATE platform.subscriptions SET scheduled_plan_code = CASE WHEN target.rank < current_rank THEN p_plan END,
        scheduled_interval = CASE WHEN NOT cancelling AND next_interval <> billing_interval THEN next_interval END
  WHERE business_id = p_business_id RETURNING * INTO sub;
 PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
 SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('used', platform.usage_count(p_business_id, e.key), 'limit', e.value)), '{}'::jsonb)
   INTO over FROM platform.plan_entitlements e
  WHERE sub.scheduled_plan_code IS NOT NULL AND e.plan_code = sub.scheduled_plan_code
    AND e.key IN ('users.max', 'outlets.max', 'catalog.max_items') AND jsonb_typeof(e.value) = 'number'
    AND platform.usage_count(p_business_id, e.key) > e.value::text::integer;
 RETURN jsonb_build_object('scheduled_plan', sub.scheduled_plan_code, 'scheduled_interval', sub.scheduled_interval,
  'effective_at', sub.current_period_end, 'over_limits', over);
END $$;

-- The plan and interval the next period will have.
CREATE FUNCTION platform.next_period_terms(s platform.subscriptions, OUT plan_code text, OUT billing_interval text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 plan_code := CASE WHEN s.scheduled_plan_code IS NOT NULL AND platform.mode_allowed(s.business_id, s.scheduled_plan_code)
                   THEN s.scheduled_plan_code ELSE s.plan_code END;
 billing_interval := coalesce(s.scheduled_interval, s.billing_interval);
 IF platform.plan_price(plan_code, billing_interval) IS NULL THEN billing_interval := 'monthly'; END IF;
END $$;

CREATE OR REPLACE FUNCTION platform.issue_renewals(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; terms record; price bigint; owner uuid; billed record; issued integer := 0;
BEGIN
 FOR sub IN SELECT s.* FROM platform.subscriptions s
             WHERE s.status = 'active' AND s.current_period_end <= p_now + interval '3 days'
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

CREATE OR REPLACE FUNCTION platform.void_stale_renewals() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE terms record;
BEGIN
 SELECT * INTO terms FROM platform.next_period_terms(NEW);
 UPDATE platform.invoices SET status = 'void'
  WHERE business_id = NEW.business_id AND kind = 'renewal' AND status = 'open'
    AND (period_start IS DISTINCT FROM NEW.current_period_end OR plan_code <> terms.plan_code OR billing_interval <> terms.billing_interval);
 RETURN NEW;
END $$;
DROP TRIGGER subscriptions_void_stale_renewals ON platform.subscriptions;
CREATE TRIGGER subscriptions_void_stale_renewals
 AFTER UPDATE OF plan_code, scheduled_plan_code, current_period_end, billing_interval, scheduled_interval ON platform.subscriptions FOR EACH ROW
 WHEN (NEW.plan_code IS DISTINCT FROM OLD.plan_code OR NEW.scheduled_plan_code IS DISTINCT FROM OLD.scheduled_plan_code
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
       OR NEW.scheduled_interval IS DISTINCT FROM OLD.scheduled_interval)
 EXECUTE FUNCTION platform.void_stale_renewals();

CREATE OR REPLACE FUNCTION platform.end_periods(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grace integer; changed integer;
BEGIN
 SELECT grace_days INTO grace FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Paid period ended; renewal due', true);
 UPDATE platform.subscriptions s
    SET plan_code = (platform.next_period_terms(s)).plan_code, billing_interval = (platform.next_period_terms(s)).billing_interval,
        status = 'past_due', grace_ends_at = s.current_period_end + make_interval(days => grace),
        scheduled_plan_code = NULL, scheduled_interval = NULL
  WHERE s.status = 'active' AND s.current_period_end <= p_now;
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed;
END $$;

-- As before. An upgrade that changes the interval (monthly to yearly) starts a fresh year on payment; a same-interval
-- upgrade keeps the period. Any payment that activates clears scheduled changes.
CREATE OR REPLACE FUNCTION platform.apply_verified_payment(p_reference text, p_amount_kobo bigint, p_currency text, p_paid_at timestamptz,
                                                           p_channel text, p_event_key text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE; rec platform.receipts%ROWTYPE; sub platform.subscriptions%ROWTYPE; result text;
 period interval; starts timestamptz; found_invoice boolean;
BEGIN
 SELECT * INTO inv FROM platform.invoices
  WHERE reference = p_reference OR id = (SELECT invoice_id FROM platform.charge_attempts WHERE reference = p_reference) FOR UPDATE;
 found_invoice := FOUND;
 IF found_invoice THEN SELECT * INTO sub FROM platform.subscriptions WHERE business_id = inv.business_id FOR UPDATE; END IF;
 period := CASE inv.billing_interval WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END;
 IF NOT found_invoice THEN
  result := 'unknown_reference';
 ELSIF inv.status = 'paid' THEN
  result := 'already_applied';
 ELSIF inv.status = 'void' THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'invoice_void';
 ELSIF inv.status <> 'open' THEN
  result := 'invoice_' || inv.status;
 ELSIF p_amount_kobo IS DISTINCT FROM inv.total_kobo OR p_currency IS DISTINCT FROM inv.currency THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'amount_or_currency_mismatch';
 ELSIF inv.kind = 'upgrade' AND (sub.status <> 'active' OR sub.current_period_end IS DISTINCT FROM inv.period_end
       OR (inv.billing_interval = sub.billing_interval AND (SELECT rank FROM platform.plans WHERE code = inv.plan_code) <= (SELECT rank FROM platform.plans WHERE code = sub.plan_code))
       OR (inv.billing_interval <> sub.billing_interval AND (SELECT rank FROM platform.plans WHERE code = inv.plan_code) < (SELECT rank FROM platform.plans WHERE code = sub.plan_code))) THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'upgrade_no_longer_applies';
 ELSIF inv.kind = 'renewal' AND sub.current_period_end IS DISTINCT FROM inv.period_start THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'renewal_no_longer_applies';
 ELSE
  UPDATE platform.invoices SET status = 'paid', paid_at = p_paid_at WHERE id = inv.id;
  INSERT INTO platform.receipts(invoice_id, business_id, amount_kobo, channel, paid_at)
  VALUES (inv.id, inv.business_id, p_amount_kobo, p_channel, p_paid_at) RETURNING * INTO rec;
  PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Payment verified for ' || inv.number, true),
          set_config('platform.actor_id', inv.created_by::text, true);
  IF inv.kind = 'upgrade' AND inv.billing_interval = sub.billing_interval THEN
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, scheduled_plan_code = NULL, scheduled_interval = NULL
    WHERE business_id = inv.business_id;
  ELSE
   starts := CASE WHEN inv.kind = 'renewal' AND sub.status <> 'suspended' THEN inv.period_start ELSE p_paid_at END;
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, billing_interval = inv.billing_interval, status = 'active',
          current_period_start = starts, current_period_end = starts + period, grace_ends_at = NULL,
          scheduled_plan_code = NULL, scheduled_interval = NULL, cancel_at_period_end = false
    WHERE business_id = inv.business_id;
  END IF;
  PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
  result := 'activated';
 END IF;
 UPDATE platform.charge_attempts SET finished_at = now(), outcome = result WHERE reference = p_reference AND finished_at IS NULL;
 IF p_event_key IS NOT NULL THEN
  UPDATE platform.billing_events SET processed_at = now(), outcome = result WHERE event_key = p_event_key;
 END IF;
 RETURN jsonb_build_object('outcome', result, 'invoice', inv.number, 'receipt', rec.number);
END $$;

-- The plan a member sees, now with a scheduled interval change.
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
  'scheduled_plan', s.scheduled_plan_code, 'scheduled_interval', s.scheduled_interval, 'cancel_at_period_end', s.cancel_at_period_end,
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

REVOKE ALL ON FUNCTION platform.change_charge(uuid, text, text, timestamptz), platform.schedule_plan_change(uuid, uuid, text, text),
 platform.next_period_terms(platform.subscriptions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.schedule_plan_change(uuid, uuid, text, text) TO cacu_runtime;
REVOKE ALL ON FUNCTION public.billing_quote(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_quote(uuid, text, text) TO authenticated;
