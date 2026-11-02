-- Renewals and saved cards (Doc 14 SUB-04, SUB-08). Three days before a paid period ends, CACU issues a renewal
-- invoice for the next period, on the plan that period will have (a scheduled downgrade included). If a reusable card
-- was saved from an earlier payment, the renewal operator charges it on the due date and retries a decline on days
-- 1, 3 and 5 of grace; every attempt has its own reference, and only Paystack's verify endpoint activates anything.
-- Without a card, or after a decline, the owner pays the same invoice from the billing screen.
SET LOCAL search_path = public, pg_catalog;

-- The authorization code can charge the card with CACU's secret key: only definer functions read it. Owners and
-- Admins see the brand, last four digits and expiry, and can remove it.
CREATE TABLE platform.payment_methods (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 authorization_code text NOT NULL CHECK (authorization_code ~ '^AUTH_[A-Za-z0-9]+$'),
 email text NOT NULL,
 card_type text,
 bank text,
 last4 text CHECK (last4 ~ '^[0-9]{4}$'),
 exp_month text,
 exp_year text,
 saved_from text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform.payment_methods ENABLE ROW LEVEL SECURITY;

ALTER TABLE platform.invoices DROP CONSTRAINT invoices_kind_check,
 ADD CONSTRAINT invoices_kind_check CHECK (kind IN ('subscription', 'upgrade', 'renewal')),
 -- For a renewal: when the period it pays for starts (the end of the period it renews).
 ADD COLUMN period_start timestamptz,
 ADD CONSTRAINT invoices_renewal_period CHECK ((kind = 'renewal') = (period_start IS NOT NULL));
CREATE UNIQUE INDEX invoices_one_renewal_per_period ON platform.invoices(business_id, period_start)
 WHERE kind = 'renewal' AND status <> 'void';

CREATE TABLE platform.charge_attempts (
 reference text PRIMARY KEY CHECK (reference ~ '^CACU-REN-[0-9a-f]{32}$'),
 invoice_id uuid NOT NULL REFERENCES platform.invoices(id),
 attempt smallint NOT NULL CHECK (attempt BETWEEN 1 AND 4),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 outcome text,
 message text,
 UNIQUE (invoice_id, attempt)
);
CREATE TRIGGER charge_attempts_no_delete BEFORE DELETE ON platform.charge_attempts
 FOR EACH ROW EXECUTE FUNCTION platform.refuse_delete();
ALTER TABLE platform.charge_attempts ENABLE ROW LEVEL SECURITY;

-- When the next attempt may run: on the due date (from six hours before the period ends, Lagos morning), then on
-- days 1, 3 and 5 after it. NULL when no attempt is left.
CREATE FUNCTION platform.next_charge_at(p_invoice_id uuid) RETURNS timestamptz
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT i.period_start + (ARRAY[interval '-6 hours', interval '1 day', interval '3 days', interval '5 days'])[n.made + 1]
   FROM platform.invoices i, LATERAL (SELECT count(*)::integer AS made FROM platform.charge_attempts a WHERE a.invoice_id = i.id) n
  WHERE i.id = p_invoice_id AND n.made < 4;
$$;

-- SUB-04: issue the renewal invoices due in the next three days. Idempotent; run hourly by the scheduler.
CREATE FUNCTION platform.issue_renewals(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sub platform.subscriptions%ROWTYPE; next_plan text; next_interval text; price bigint; owner uuid; billed record; issued integer := 0;
BEGIN
 FOR sub IN SELECT s.* FROM platform.subscriptions s
             WHERE s.status = 'active' AND s.current_period_end <= p_now + interval '3 days'
               AND NOT EXISTS (SELECT FROM platform.invoices i WHERE i.business_id = s.business_id AND i.kind = 'renewal'
                                AND i.period_start = s.current_period_end AND i.status <> 'void')
             FOR UPDATE OF s LOOP
  next_plan := CASE WHEN sub.scheduled_plan_code IS NOT NULL AND platform.mode_allowed(sub.business_id, sub.scheduled_plan_code)
                    THEN sub.scheduled_plan_code ELSE sub.plan_code END;
  next_interval := sub.billing_interval;
  price := platform.plan_price(next_plan, next_interval);
  IF price IS NULL THEN next_interval := 'monthly'; price := platform.plan_price(next_plan, 'monthly'); END IF;
  SELECT user_id INTO owner FROM public.memberships WHERE business_id = sub.business_id AND role::text = 'owner' AND is_active LIMIT 1;
  CONTINUE WHEN owner IS NULL OR price IS NULL;
  SELECT * INTO billed FROM platform.with_vat(price);
  INSERT INTO platform.invoices(business_id, request_key, plan_code, billing_interval, subtotal_kobo, vat_rate_bps, vat_kobo,
                                total_kobo, reference, created_by, kind, period_start)
  VALUES (sub.business_id, gen_random_uuid(), next_plan, next_interval, billed.subtotal, billed.rate, billed.vat, billed.subtotal + billed.vat,
          'CACU-SUB-' || replace(gen_random_uuid()::text, '-', ''), owner, 'renewal', sub.current_period_end);
  issued := issued + 1;
 END LOOP;
 RETURN issued;
END $$;

-- A renewal invoice describes one plan for one period. If an upgrade, a new or cancelled downgrade or a fresh period
-- means it no longer matches, it is voided and the next issue_renewals run issues a fresh one. The period end itself
-- (end_periods applying the scheduled plan) still matches, so the invoice and its card retries carry on.
CREATE FUNCTION platform.void_stale_renewals() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 UPDATE platform.invoices SET status = 'void'
  WHERE business_id = NEW.business_id AND kind = 'renewal' AND status = 'open'
    AND (period_start IS DISTINCT FROM NEW.current_period_end
         OR plan_code <> CASE WHEN NEW.scheduled_plan_code IS NOT NULL AND platform.mode_allowed(NEW.business_id, NEW.scheduled_plan_code)
                              THEN NEW.scheduled_plan_code ELSE NEW.plan_code END);
 RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_void_stale_renewals AFTER UPDATE OF plan_code, scheduled_plan_code, current_period_end, billing_interval
 ON platform.subscriptions FOR EACH ROW
 WHEN (NEW.plan_code IS DISTINCT FROM OLD.plan_code OR NEW.scheduled_plan_code IS DISTINCT FROM OLD.scheduled_plan_code
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval)
 EXECUTE FUNCTION platform.void_stale_renewals();

-- The renewal operator's queue: open renewal invoices with a saved card whose next attempt is due, for businesses
-- still inside grace. An attempt that has not finished within an hour does not block the next one.
CREATE FUNCTION platform.due_card_charges(p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(jsonb_agg(i.reference ORDER BY i.period_start), '[]'::jsonb)
   FROM platform.invoices i
   JOIN platform.subscriptions s ON s.business_id = i.business_id AND s.status IN ('active', 'past_due', 'grace')
   JOIN platform.payment_methods m ON m.business_id = i.business_id
  WHERE i.kind = 'renewal' AND i.status = 'open' AND platform.next_charge_at(i.id) <= p_now
    AND NOT EXISTS (SELECT FROM platform.charge_attempts a WHERE a.invoice_id = i.id AND a.finished_at IS NULL
                     AND a.started_at > p_now - interval '1 hour');
$$;

-- Claims the next attempt for one invoice, re-checking that it is due, and returns what Paystack needs. NULL when
-- another run already took it or nothing is due.
CREATE FUNCTION platform.start_charge_attempt(p_reference text, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE; card platform.payment_methods%ROWTYPE; made integer; ref text;
BEGIN
 SELECT * INTO inv FROM platform.invoices WHERE reference = p_reference AND kind = 'renewal' FOR UPDATE;
 IF NOT FOUND OR inv.status <> 'open' OR NOT (platform.due_card_charges(p_now) ? p_reference) THEN RETURN NULL; END IF;
 SELECT * INTO card FROM platform.payment_methods WHERE business_id = inv.business_id;
 SELECT count(*) INTO made FROM platform.charge_attempts WHERE invoice_id = inv.id;
 ref := 'CACU-REN-' || replace(gen_random_uuid()::text, '-', '');
 INSERT INTO platform.charge_attempts(reference, invoice_id, attempt) VALUES (ref, inv.id, made + 1);
 RETURN jsonb_build_object('reference', ref, 'invoice', inv.number, 'attempt', made + 1, 'amount_kobo', inv.total_kobo,
  'email', card.email, 'authorization_code', card.authorization_code, 'business_id', inv.business_id);
END $$;

CREATE FUNCTION platform.finish_charge_attempt(p_reference text, p_outcome text, p_message text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 UPDATE platform.charge_attempts SET finished_at = now(), outcome = left(p_outcome, 60), message = left(p_message, 200)
  WHERE reference = p_reference AND finished_at IS NULL;
$$;

-- Saves the reusable card from a verified payment of a paid CACU invoice. Called by the Python core after activation.
CREATE FUNCTION platform.save_payment_method(p_reference text, p_authorization jsonb, p_email text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE;
BEGIN
 SELECT i.* INTO inv FROM platform.invoices i
  WHERE i.status = 'paid' AND (i.reference = p_reference
        OR i.id = (SELECT invoice_id FROM platform.charge_attempts WHERE reference = p_reference));
 IF NOT FOUND OR p_authorization->>'reusable' IS DISTINCT FROM 'true' OR p_authorization->>'channel' IS DISTINCT FROM 'card'
    OR coalesce(p_authorization->>'authorization_code', '') !~ '^AUTH_[A-Za-z0-9]+$' OR coalesce(p_email, '') = '' THEN
  RETURN false;
 END IF;
 INSERT INTO platform.payment_methods(business_id, authorization_code, email, card_type, bank, last4, exp_month, exp_year, saved_from)
 VALUES (inv.business_id, p_authorization->>'authorization_code', p_email, left(p_authorization->>'card_type', 30), left(p_authorization->>'bank', 60),
         CASE WHEN p_authorization->>'last4' ~ '^[0-9]{4}$' THEN p_authorization->>'last4' END,
         left(p_authorization->>'exp_month', 2), left(p_authorization->>'exp_year', 4), inv.number)
 ON CONFLICT (business_id) DO UPDATE SET authorization_code = EXCLUDED.authorization_code, email = EXCLUDED.email,
  card_type = EXCLUDED.card_type, bank = EXCLUDED.bank, last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month,
  exp_year = EXCLUDED.exp_year, saved_from = EXCLUDED.saved_from, updated_at = now();
 RETURN true;
END $$;

-- The owner pays the open renewal invoice from the billing screen: the same checkout as a new plan, on this invoice.
CREATE FUNCTION platform.renewal_checkout(p_business_id uuid, p_actor uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE; email text;
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'BILLING_OWNER_OR_ADMIN_REQUIRED' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO inv FROM platform.invoices WHERE business_id = p_business_id AND kind = 'renewal' AND status = 'open'
  ORDER BY period_start DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_NO_RENEWAL_DUE' USING ERRCODE = 'P0001'; END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id = p_actor;
 RETURN jsonb_build_object('invoice', inv.number, 'reference', inv.reference, 'plan', inv.plan_code, 'kind', inv.kind,
  'billing_interval', inv.billing_interval, 'subtotal_kobo', inv.subtotal_kobo, 'vat_kobo', inv.vat_kobo,
  'total_kobo', inv.total_kobo, 'currency', inv.currency, 'status', inv.status, 'authorization_url', inv.authorization_url,
  'email', email, 'period_end', NULL);
END $$;

-- As before, plus renewals and card-charge references. A renewal starts where the renewed period ended, so paying
-- inside grace loses no days; once suspended, it starts from the payment. A payment for an invoice that no longer
-- applies (voided, or a period that changed) is flagged for review and changes nothing else.
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
       OR (SELECT rank FROM platform.plans WHERE code = inv.plan_code) <= (SELECT rank FROM platform.plans WHERE code = sub.plan_code)) THEN
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
  IF inv.kind = 'upgrade' THEN
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, scheduled_plan_code = NULL WHERE business_id = inv.business_id;
  ELSE
   starts := CASE WHEN inv.kind = 'renewal' AND sub.status <> 'suspended' THEN inv.period_start ELSE p_paid_at END;
   UPDATE platform.subscriptions SET plan_code = inv.plan_code, billing_interval = inv.billing_interval, status = 'active',
          current_period_start = starts, current_period_end = starts + period, grace_ends_at = NULL,
          scheduled_plan_code = NULL, cancel_at_period_end = false
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

-- The plan a member sees, plus for Owners and Admins the saved card and the renewal that is due.
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
             FROM unnest(ARRAY['users.max', 'outlets.max', 'catalog.max_items']) k),
  'card', CASE WHEN manager THEN (SELECT jsonb_build_object('card_type', m.card_type, 'bank', m.bank, 'last4', m.last4,
             'exp_month', m.exp_month, 'exp_year', m.exp_year) FROM platform.payment_methods m WHERE m.business_id = p_business_id) END,
  'renewal', CASE WHEN manager THEN (SELECT jsonb_build_object('invoice', i.number, 'plan', i.plan_code, 'billing_interval', i.billing_interval,
             'total_kobo', i.total_kobo, 'due_at', i.period_start,
             'last_failure', (SELECT a.message FROM platform.charge_attempts a WHERE a.invoice_id = i.id AND a.outcome NOT IN ('activated')
                               ORDER BY a.attempt DESC LIMIT 1))
             FROM platform.invoices i WHERE i.business_id = p_business_id AND i.kind = 'renewal' AND i.status = 'open'
             ORDER BY i.period_start DESC LIMIT 1) END);
END $$;

CREATE FUNCTION public.remove_payment_method(p_business_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 DELETE FROM platform.payment_methods WHERE business_id = p_business_id;
END $$;

CREATE OR REPLACE FUNCTION ops.run_job(p_job text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE started timestamptz := clock_timestamp(); n integer; message text;
BEGIN
 IF p_job NOT IN ('billing.end_trials', 'billing.issue_renewals', 'billing.end_periods', 'billing.suspend_unpaid') THEN
  RAISE EXCEPTION 'UNKNOWN_JOB %', p_job USING ERRCODE = '22023';
 END IF;
 BEGIN
  n := CASE p_job WHEN 'billing.end_trials' THEN platform.end_trials()
                  WHEN 'billing.issue_renewals' THEN platform.issue_renewals()
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

REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.next_charge_at(uuid), platform.issue_renewals(timestamptz), platform.void_stale_renewals(),
 platform.due_card_charges(timestamptz), platform.start_charge_attempt(text, timestamptz), platform.finish_charge_attempt(text, text, text),
 platform.save_payment_method(text, jsonb, text), platform.renewal_checkout(uuid, uuid), ops.run_job(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_payment_method(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_payment_method(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.due_card_charges(timestamptz), platform.start_charge_attempt(text, timestamptz),
 platform.finish_charge_attempt(text, text, text), platform.save_payment_method(text, jsonb, text), platform.renewal_checkout(uuid, uuid)
 TO cacu_runtime;

DO $schedule$
BEGIN
 IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('cacu-billing-issue-renewals', '27 * * * *', $job$SELECT ops.run_job('billing.issue_renewals')$job$);
 END IF;
END
$schedule$;
