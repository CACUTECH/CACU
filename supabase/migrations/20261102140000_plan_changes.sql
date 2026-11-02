-- Plan changes on an active subscription and the end of a paid period (Doc 14 SUB-05, SUB-06, SUB-09).
-- Upgrade: a prorated CACU invoice for the rest of the period; on payment the new plan's limits apply at once and
-- the period end is unchanged. Downgrade: scheduled, never charged, and applied when the period ends.
-- Period end: an active subscription whose period has ended moves to payment due with the usual grace period, then
-- suspend_unpaid makes it read-only. The owner renews through the normal checkout; saved-card renewal is SUB-04/08.
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE platform.invoices
 ADD COLUMN kind text NOT NULL DEFAULT 'subscription' CHECK (kind IN ('subscription', 'upgrade')),
 -- For an upgrade: the period end the charge was prorated to. Payment applies only while that period still runs.
 ADD COLUMN period_end timestamptz,
 ADD CONSTRAINT invoices_upgrade_period CHECK ((kind = 'upgrade') = (period_end IS NOT NULL));

-- Splits a price into subtotal and VAT the same way for every invoice.
CREATE FUNCTION platform.with_vat(p_amount bigint, OUT subtotal bigint, OUT vat bigint, OUT rate integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.settings%ROWTYPE;
BEGIN
 SELECT * INTO s FROM platform.settings WHERE id = 1;
 rate := CASE WHEN s.vat_registered THEN s.vat_rate_bps ELSE 0 END;
 IF s.prices_include_vat THEN
  vat := round(p_amount * rate::numeric / (10000 + rate)); subtotal := p_amount - vat;
 ELSE
  subtotal := p_amount; vat := round(p_amount * rate::numeric / 10000);
 END IF;
END $$;

CREATE FUNCTION platform.plan_price(p_plan text, p_interval text) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE p_interval WHEN 'monthly' THEN monthly_price_kobo WHEN 'annual' THEN annual_price_kobo END
   FROM platform.plans WHERE code = p_plan AND active;
$$;

CREATE FUNCTION platform.mode_allowed(p_business_id uuid, p_plan text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT FROM platform.plan_entitlements e JOIN public.businesses b ON b.id = p_business_id
                 WHERE e.plan_code = p_plan AND e.key = 'module.modes' AND e.value ? b.business_type);
$$;

-- SUB-02 and SUB-05. A business that is not active pays for a full period of any plan. An active business can only
-- upgrade here, on its current billing interval; a downgrade is scheduled and an interval change waits for renewal.
CREATE OR REPLACE FUNCTION platform.open_checkout(p_business_id uuid, p_actor uuid, p_request_key uuid, p_plan text, p_interval text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
 sub platform.subscriptions%ROWTYPE; inv platform.invoices%ROWTYPE; email text; price bigint; current_price bigint;
 charge bigint; billed record; new_rank smallint; current_rank smallint; share numeric;
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
  price := platform.plan_price(p_plan, p_interval);
  IF price IS NULL THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
  IF NOT platform.mode_allowed(p_business_id, p_plan) THEN RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001'; END IF;
  charge := price;
  IF sub.status = 'active' THEN
   SELECT rank INTO new_rank FROM platform.plans WHERE code = p_plan;
   SELECT rank INTO current_rank FROM platform.plans WHERE code = sub.plan_code;
   IF new_rank = current_rank THEN RAISE EXCEPTION 'BILLING_ALREADY_ON_PLAN' USING ERRCODE = 'P0001'; END IF;
   IF new_rank < current_rank THEN RAISE EXCEPTION 'BILLING_DOWNGRADE_IS_SCHEDULED' USING ERRCODE = 'P0001'; END IF;
   IF p_interval <> sub.billing_interval THEN RAISE EXCEPTION 'BILLING_INTERVAL_CHANGES_AT_RENEWAL' USING ERRCODE = 'P0001'; END IF;
   IF sub.current_period_end - now() < interval '1 day' THEN RAISE EXCEPTION 'BILLING_RENEW_FIRST' USING ERRCODE = 'P0001'; END IF;
   -- SUB-05: new price minus the unused value of the current plan, both for the days left, to the nearest naira.
   current_price := platform.plan_price(sub.plan_code, sub.billing_interval);
   share := extract(epoch FROM sub.current_period_end - now()) / extract(epoch FROM sub.current_period_end - sub.current_period_start);
   charge := round((price - current_price) * share / 100) * 100;
   IF charge <= 0 THEN RAISE EXCEPTION 'BILLING_RENEW_FIRST' USING ERRCODE = 'P0001'; END IF;
  END IF;
  SELECT * INTO billed FROM platform.with_vat(charge);
  INSERT INTO platform.invoices(business_id, request_key, plan_code, billing_interval, subtotal_kobo, vat_rate_bps, vat_kobo,
                                total_kobo, reference, created_by, kind, period_end)
  VALUES (p_business_id, p_request_key, p_plan, p_interval, billed.subtotal, billed.rate, billed.vat, billed.subtotal + billed.vat,
          'CACU-SUB-' || replace(gen_random_uuid()::text, '-', ''), p_actor,
          CASE WHEN sub.status = 'active' THEN 'upgrade' ELSE 'subscription' END,
          CASE WHEN sub.status = 'active' THEN sub.current_period_end END)
  RETURNING * INTO inv;
 END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id = p_actor;
 RETURN jsonb_build_object('invoice', inv.number, 'reference', inv.reference, 'plan', inv.plan_code, 'kind', inv.kind,
  'billing_interval', inv.billing_interval, 'subtotal_kobo', inv.subtotal_kobo, 'vat_kobo', inv.vat_kobo,
  'total_kobo', inv.total_kobo, 'currency', inv.currency, 'status', inv.status, 'authorization_url', inv.authorization_url,
  'email', email, 'period_end', inv.period_end);
END $$;

-- SUB-06: a downgrade waits for the end of the paid period. Choosing the current plan cancels a scheduled change.
-- Returns where the business would be over the new plan's limits, so the owner can make room before it applies.
CREATE FUNCTION platform.schedule_plan_change(p_business_id uuid, p_actor uuid, p_plan text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; target platform.plans%ROWTYPE; current_rank smallint; over jsonb;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'BILLING_OWNER_OR_ADMIN_REQUIRED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO sub FROM platform.subscriptions WHERE business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_NO_SUBSCRIPTION' USING ERRCODE = 'P0001'; END IF;
 IF sub.status <> 'active' THEN RAISE EXCEPTION 'BILLING_SCHEDULE_NEEDS_ACTIVE_PLAN' USING ERRCODE = 'P0001'; END IF;
 SELECT * INTO target FROM platform.plans WHERE code = p_plan AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
 SELECT rank INTO current_rank FROM platform.plans WHERE code = sub.plan_code;
 IF target.rank > current_rank THEN RAISE EXCEPTION 'BILLING_UPGRADE_NEEDS_CHECKOUT' USING ERRCODE = 'P0001'; END IF;
 IF target.rank < current_rank AND NOT platform.mode_allowed(p_business_id, p_plan) THEN
  RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001';
 END IF;
 PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', p_actor::text, true),
         set_config('platform.reason', CASE WHEN target.rank = current_rank THEN 'Scheduled plan change cancelled'
                                            ELSE 'Downgrade to ' || target.display_name || ' scheduled for the end of the period' END, true);
 UPDATE platform.subscriptions SET scheduled_plan_code = CASE WHEN target.rank < current_rank THEN p_plan END
  WHERE business_id = p_business_id RETURNING * INTO sub;
 PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
 SELECT coalesce(jsonb_object_agg(e.key, jsonb_build_object('used', platform.usage_count(p_business_id, e.key), 'limit', e.value)), '{}'::jsonb)
   INTO over FROM platform.plan_entitlements e
  WHERE sub.scheduled_plan_code IS NOT NULL AND e.plan_code = sub.scheduled_plan_code
    AND e.key IN ('users.max', 'outlets.max', 'catalog.max_items') AND jsonb_typeof(e.value) = 'number'
    AND platform.usage_count(p_business_id, e.key) > e.value::text::integer;
 RETURN jsonb_build_object('scheduled_plan', sub.scheduled_plan_code, 'effective_at', sub.current_period_end, 'over_limits', over);
END $$;

-- SUB-09: the paid period ended without renewal. A scheduled downgrade applies first, unless the business has since
-- moved into a mode the new plan lacks; then it stays on its plan. Idempotent; run hourly by the scheduler.
CREATE FUNCTION platform.end_periods(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grace integer; changed integer;
BEGIN
 SELECT grace_days INTO grace FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Paid period ended; renewal due', true);
 UPDATE platform.subscriptions s
    SET plan_code = CASE WHEN s.scheduled_plan_code IS NOT NULL AND platform.mode_allowed(s.business_id, s.scheduled_plan_code)
                         THEN s.scheduled_plan_code ELSE s.plan_code END,
        status = 'past_due', grace_ends_at = s.current_period_end + make_interval(days => grace), scheduled_plan_code = NULL
  WHERE s.status = 'active' AND s.current_period_end <= p_now;
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed;
END $$;

-- As before, plus upgrades: an upgrade invoice changes only the plan, and only while the period it was prorated to
-- is still the current one; otherwise it is flagged for review and the payment is refunded by support.
CREATE OR REPLACE FUNCTION platform.apply_verified_payment(p_reference text, p_amount_kobo bigint, p_currency text, p_paid_at timestamptz,
                                                           p_channel text, p_event_key text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE; rec platform.receipts%ROWTYPE; sub platform.subscriptions%ROWTYPE; result text; period interval;
BEGIN
 SELECT * INTO inv FROM platform.invoices WHERE reference = p_reference FOR UPDATE;
 IF FOUND THEN SELECT * INTO sub FROM platform.subscriptions WHERE business_id = inv.business_id FOR UPDATE; END IF;
 IF NOT FOUND THEN
  result := 'unknown_reference';
 ELSIF inv.status = 'paid' THEN
  result := 'already_applied';
 ELSIF inv.status <> 'open' THEN
  result := 'invoice_' || inv.status;
 ELSIF p_amount_kobo IS DISTINCT FROM inv.total_kobo OR p_currency IS DISTINCT FROM inv.currency THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'amount_or_currency_mismatch';
 ELSIF inv.kind = 'upgrade' AND (sub.status <> 'active' OR sub.current_period_end IS DISTINCT FROM inv.period_end
       OR (SELECT rank FROM platform.plans WHERE code = inv.plan_code) <= (SELECT rank FROM platform.plans WHERE code = sub.plan_code)) THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'upgrade_no_longer_applies';
 ELSE
  UPDATE platform.invoices SET status = 'paid', paid_at = p_paid_at WHERE id = inv.id;
  INSERT INTO platform.receipts(invoice_id, business_id, amount_kobo, channel, paid_at)
  VALUES (inv.id, inv.business_id, p_amount_kobo, p_channel, p_paid_at) RETURNING * INTO rec;
  PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Payment verified for ' || inv.number, true),
          set_config('platform.actor_id', inv.created_by::text, true);
  IF inv.kind = 'upgrade' THEN
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, scheduled_plan_code = NULL WHERE business_id = inv.business_id;
  ELSE
   period := CASE inv.billing_interval WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END;
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, billing_interval = inv.billing_interval, status = 'active',
          current_period_start = p_paid_at, current_period_end = p_paid_at + period, grace_ends_at = NULL,
          scheduled_plan_code = NULL, cancel_at_period_end = false
    WHERE business_id = inv.business_id;
  END IF;
  PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
  result := 'activated';
 END IF;
 IF p_event_key IS NOT NULL THEN
  UPDATE platform.billing_events SET processed_at = now(), outcome = result WHERE event_key = p_event_key;
 END IF;
 RETURN jsonb_build_object('outcome', result, 'invoice', inv.number, 'receipt', rec.number);
END $$;

CREATE OR REPLACE FUNCTION public.business_billing_history(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('invoice', i.number, 'plan', i.plan_code, 'billing_interval', i.billing_interval,
   'kind', i.kind, 'subtotal_kobo', i.subtotal_kobo, 'vat_kobo', i.vat_kobo, 'total_kobo', i.total_kobo, 'status', i.status,
   'created_at', i.created_at, 'paid_at', i.paid_at, 'receipt', r.number) ORDER BY i.created_at DESC)
  FROM platform.invoices i LEFT JOIN platform.receipts r ON r.invoice_id = i.id WHERE i.business_id = p_business_id), '[]'::jsonb);
END $$;

-- The scheduler's job list gains the period end; it runs before suspend_unpaid's nightly pass.
CREATE OR REPLACE FUNCTION ops.run_job(p_job text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE started timestamptz := clock_timestamp(); n integer; message text;
BEGIN
 IF p_job NOT IN ('billing.end_trials', 'billing.end_periods', 'billing.suspend_unpaid') THEN
  RAISE EXCEPTION 'UNKNOWN_JOB %', p_job USING ERRCODE = '22023';
 END IF;
 BEGIN
  n := CASE p_job WHEN 'billing.end_trials' THEN platform.end_trials()
                  WHEN 'billing.end_periods' THEN platform.end_periods()
                  ELSE platform.suspend_unpaid() END;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
  INSERT INTO ops.job_runs(job, started_at, ok, error) VALUES (p_job, started, false, left(message, 1000));
  RETURN jsonb_build_object('job', p_job, 'ok', false, 'error', left(message, 1000));
 END;
 INSERT INTO ops.job_runs(job, started_at, ok, changed) VALUES (p_job, started, true, n);
 RETURN jsonb_build_object('job', p_job, 'ok', true, 'changed', n);
END $$;

REVOKE ALL ON FUNCTION platform.with_vat(bigint), platform.plan_price(text, text), platform.mode_allowed(uuid, text),
 platform.schedule_plan_change(uuid, uuid, text), platform.end_periods(timestamptz), ops.run_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.schedule_plan_change(uuid, uuid, text) TO cacu_runtime;

DO $schedule$
BEGIN
 IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('cacu-billing-end-periods', '17 * * * *', $job$SELECT ops.run_job('billing.end_periods')$job$);
 END IF;
END
$schedule$;
