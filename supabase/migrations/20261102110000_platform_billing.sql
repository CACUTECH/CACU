-- CACU billing, part 2 (Doc 14 SUB-01 to SUB-03, SUB-14; Doc 11 Paystack webhook). Owner decisions of 2 November 2026:
-- a 14-day Oga trial for every new business, ending on General; annual prices of N60,000 (Oga) and N150,000 (Chairman);
-- prices exclude VAT and CACU is VAT-registered, so 7.5% VAT is added on every CACU invoice. A subscription becomes
-- active only after the Python core has verified the payment with Paystack and the exact amount, currency and
-- reference match a CACU invoice (SUB-R01). Tenant roles have no access; the runtime role calls the functions below.
SET LOCAL search_path = public, pg_catalog;

UPDATE platform.plans SET annual_price_kobo = 6000000, updated_at = now() WHERE code = 'GROW';
UPDATE platform.plans SET annual_price_kobo = 15000000, updated_at = now() WHERE code = 'TOP';

CREATE TABLE platform.settings (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 vat_registered boolean NOT NULL,
 vat_rate_bps integer NOT NULL CHECK (vat_rate_bps BETWEEN 0 AND 10000),
 prices_include_vat boolean NOT NULL,
 trial_plan text NOT NULL REFERENCES platform.plans(code),
 trial_days integer NOT NULL CHECK (trial_days BETWEEN 0 AND 90),
 after_trial_plan text NOT NULL REFERENCES platform.plans(code),
 grace_days integer NOT NULL CHECK (grace_days BETWEEN 0 AND 60),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.settings VALUES (1, true, 750, false, 'GROW', 14, 'BASE', 7);
ALTER TABLE platform.settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform.audit_config() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
 INSERT INTO platform.config_changes(table_name, row_key, old_value, new_value)
 VALUES (TG_TABLE_NAME,
         CASE TG_TABLE_NAME WHEN 'plans' THEN jsonb_build_object('code', r->'code')
              WHEN 'settings' THEN jsonb_build_object('id', r->'id')
              ELSE jsonb_build_object('plan_code', r->'plan_code', 'key', r->'key') END,
         CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
         CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
 RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER settings_audit AFTER INSERT OR UPDATE OR DELETE ON platform.settings
 FOR EACH ROW EXECUTE FUNCTION platform.audit_config();

-- SUB-01: every new business starts its trial in the same transaction as setup. A Hybrid business is refused here by
-- subscriptions_plan_mode, because the trial plan has no Hybrid mode.
CREATE FUNCTION platform.start_trial() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.settings%ROWTYPE;
BEGIN
 SELECT * INTO s FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Trial started at setup', true),
         set_config('platform.actor_id', coalesce(NEW.created_by::text, ''), true);
 INSERT INTO platform.subscriptions(business_id, plan_code, status, current_period_start, current_period_end)
 VALUES (NEW.id, s.trial_plan, 'trialing', now(), now() + make_interval(days => s.trial_days));
 PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
 RETURN NEW;
END $$;
CREATE TRIGGER businesses_start_trial AFTER INSERT ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION platform.start_trial();

-- Trials end on General with the first payment due; the grace period keeps full access (SUB-01, SUB-09). Unpaid
-- businesses past grace become read-only (SUB-10). Run by the scheduler with the system actor; both are idempotent.
CREATE FUNCTION platform.end_trials(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.settings%ROWTYPE; changed integer;
BEGIN
 SELECT * INTO s FROM platform.settings WHERE id = 1;
 PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Trial ended; first payment due', true);
 UPDATE platform.subscriptions SET plan_code = s.after_trial_plan, status = 'incomplete', billing_interval = 'monthly',
        grace_ends_at = current_period_end + make_interval(days => s.grace_days)
  WHERE status = 'trialing' AND current_period_end <= p_now;
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed;
END $$;

CREATE FUNCTION platform.suspend_unpaid(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE changed integer;
BEGIN
 PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Unpaid after the grace period', true);
 UPDATE platform.subscriptions SET status = 'suspended'
  WHERE status IN ('incomplete', 'past_due', 'grace') AND grace_ends_at <= p_now;
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed;
END $$;

CREATE SEQUENCE platform.invoice_number_seq;
CREATE SEQUENCE platform.receipt_number_seq;

-- SUB-14, SUB-R07: sequential CACU invoices and receipts, kept forever. Amounts in kobo.
CREATE TABLE platform.invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number text NOT NULL UNIQUE DEFAULT 'CACU-INV-' || lpad(nextval('platform.invoice_number_seq')::text, 6, '0'),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 request_key uuid NOT NULL,
 plan_code text NOT NULL REFERENCES platform.plans(code),
 billing_interval text NOT NULL CHECK (billing_interval IN ('monthly','annual')),
 subtotal_kobo bigint NOT NULL CHECK (subtotal_kobo > 0),
 vat_rate_bps integer NOT NULL,
 vat_kobo bigint NOT NULL CHECK (vat_kobo >= 0),
 total_kobo bigint NOT NULL CHECK (total_kobo = subtotal_kobo + vat_kobo),
 currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
 reference text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','review','void')),
 authorization_url text,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 paid_at timestamptz,
 UNIQUE (business_id, request_key)
);

CREATE TABLE platform.receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number text NOT NULL UNIQUE DEFAULT 'CACU-RCT-' || lpad(nextval('platform.receipt_number_seq')::text, 6, '0'),
 invoice_id uuid NOT NULL UNIQUE REFERENCES platform.invoices(id),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
 provider text NOT NULL DEFAULT 'paystack',
 channel text,
 paid_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Raw provider events, stored once by event key so repeated deliveries are ignored (SUB-03, TEST-203).
CREATE TABLE platform.billing_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL DEFAULT 'paystack',
 event_key text NOT NULL UNIQUE,
 event_type text NOT NULL,
 reference text,
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 outcome text
);

CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON platform.receipts
 FOR EACH ROW EXECUTE FUNCTION platform.refuse_delete();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON platform.invoices
 FOR EACH ROW EXECUTE FUNCTION platform.refuse_delete();
ALTER TABLE platform.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.billing_events ENABLE ROW LEVEL SECURITY;

-- SUB-02: an active Owner or Admin opens a checkout for a plan. Idempotent on (business, request key). Plan changes
-- for a business that is already active wait for upgrades and downgrades with proration (SUB-05, SUB-06).
CREATE FUNCTION platform.open_checkout(p_business_id uuid, p_actor uuid, p_request_key uuid, p_plan text, p_interval text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
 s platform.settings%ROWTYPE; sub platform.subscriptions%ROWTYPE; p platform.plans%ROWTYPE;
 inv platform.invoices%ROWTYPE; mode text; email text; price bigint; vat bigint;
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
  IF sub.status = 'active' THEN RAISE EXCEPTION 'BILLING_PLAN_CHANGE_NOT_AVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO p FROM platform.plans WHERE code = p_plan AND active;
  IF NOT FOUND OR p_interval NOT IN ('monthly','annual') THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
  price := CASE p_interval WHEN 'monthly' THEN p.monthly_price_kobo ELSE p.annual_price_kobo END;
  IF price IS NULL THEN RAISE EXCEPTION 'BILLING_PLAN_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT business_type INTO mode FROM public.businesses WHERE id = p_business_id;
  IF NOT EXISTS (SELECT FROM platform.plan_entitlements WHERE plan_code = p_plan AND key = 'module.modes' AND value ? mode) THEN
   RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO s FROM platform.settings WHERE id = 1;
  IF s.prices_include_vat THEN
   vat := CASE WHEN s.vat_registered THEN round(price * s.vat_rate_bps::numeric / (10000 + s.vat_rate_bps)) ELSE 0 END;
   price := price - vat;
  ELSE
   vat := CASE WHEN s.vat_registered THEN round(price * s.vat_rate_bps::numeric / 10000) ELSE 0 END;
  END IF;
  INSERT INTO platform.invoices(business_id, request_key, plan_code, billing_interval, subtotal_kobo, vat_rate_bps, vat_kobo,
                                total_kobo, reference, created_by)
  VALUES (p_business_id, p_request_key, p_plan, p_interval, price, CASE WHEN s.vat_registered THEN s.vat_rate_bps ELSE 0 END,
          vat, price + vat, 'CACU-SUB-' || replace(gen_random_uuid()::text, '-', ''), p_actor)
  RETURNING * INTO inv;
 END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id = p_actor;
 RETURN jsonb_build_object('invoice', inv.number, 'reference', inv.reference, 'plan', inv.plan_code,
  'billing_interval', inv.billing_interval, 'subtotal_kobo', inv.subtotal_kobo, 'vat_kobo', inv.vat_kobo,
  'total_kobo', inv.total_kobo, 'currency', inv.currency, 'status', inv.status, 'authorization_url', inv.authorization_url,
  'email', email);
END $$;

-- Paystack initialise returns the checkout link once; keeping it lets a retried checkout reuse the same reference.
CREATE FUNCTION platform.attach_checkout(p_reference text, p_authorization_url text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 UPDATE platform.invoices SET authorization_url = p_authorization_url
  WHERE reference = p_reference AND status = 'open' AND authorization_url IS NULL;
$$;

CREATE FUNCTION platform.invoice_for(p_business_id uuid, p_actor uuid, p_reference text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 RETURN (SELECT jsonb_build_object('reference', reference, 'status', status, 'total_kobo', total_kobo, 'currency', currency)
           FROM platform.invoices WHERE business_id = p_business_id AND reference = p_reference);
END $$;

CREATE FUNCTION platform.record_billing_event(p_event_key text, p_event_type text, p_reference text, p_payload jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 INSERT INTO platform.billing_events(event_key, event_type, reference, payload) VALUES (p_event_key, p_event_type, p_reference, p_payload)
 ON CONFLICT (event_key) DO NOTHING;
 -- A redelivery is processed again until one attempt finished; activation itself happens at most once per invoice.
 RETURN (SELECT processed_at IS NULL FROM platform.billing_events WHERE event_key = p_event_key);
END $$;

-- Applies a payment the Python core has already confirmed with Paystack's verify endpoint. Exactly one activation per
-- invoice; any mismatch flags the invoice for review and changes nothing else (TEST-203, TEST-204).
CREATE FUNCTION platform.apply_verified_payment(p_reference text, p_amount_kobo bigint, p_currency text, p_paid_at timestamptz,
                                                p_channel text, p_event_key text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE inv platform.invoices%ROWTYPE; rec platform.receipts%ROWTYPE; result text; period interval;
BEGIN
 SELECT * INTO inv FROM platform.invoices WHERE reference = p_reference FOR UPDATE;
 IF NOT FOUND THEN
  result := 'unknown_reference';
 ELSIF inv.status = 'paid' THEN
  result := 'already_applied';
 ELSIF inv.status <> 'open' THEN
  result := 'invoice_' || inv.status;
 ELSIF p_amount_kobo IS DISTINCT FROM inv.total_kobo OR p_currency IS DISTINCT FROM inv.currency THEN
  UPDATE platform.invoices SET status = 'review' WHERE id = inv.id;
  result := 'amount_or_currency_mismatch';
 ELSE
  UPDATE platform.invoices SET status = 'paid', paid_at = p_paid_at WHERE id = inv.id;
  INSERT INTO platform.receipts(invoice_id, business_id, amount_kobo, channel, paid_at)
  VALUES (inv.id, inv.business_id, p_amount_kobo, p_channel, p_paid_at) RETURNING * INTO rec;
  period := CASE inv.billing_interval WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END;
  PERFORM set_config('platform.actor_kind', 'system', true), set_config('platform.reason', 'Payment verified for ' || inv.number, true),
          set_config('platform.actor_id', inv.created_by::text, true);
  UPDATE platform.subscriptions SET plan_code = inv.plan_code, billing_interval = inv.billing_interval, status = 'active',
         current_period_start = p_paid_at, current_period_end = p_paid_at + period, grace_ends_at = NULL,
         scheduled_plan_code = NULL, cancel_at_period_end = false
   WHERE business_id = inv.business_id;
  PERFORM set_config('platform.reason', '', true), set_config('platform.actor_id', '', true);
  result := 'activated';
 END IF;
 IF p_event_key IS NOT NULL THEN
  UPDATE platform.billing_events SET processed_at = now(), outcome = result WHERE event_key = p_event_key;
 END IF;
 RETURN jsonb_build_object('outcome', result, 'invoice', inv.number, 'receipt', rec.number);
END $$;

-- Owners see their own invoices and receipts (SUB-13); nothing else in platform is visible to them.
CREATE FUNCTION public.business_billing_history(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('invoice', i.number, 'plan', i.plan_code, 'billing_interval', i.billing_interval,
   'subtotal_kobo', i.subtotal_kobo, 'vat_kobo', i.vat_kobo, 'total_kobo', i.total_kobo, 'status', i.status,
   'created_at', i.created_at, 'paid_at', i.paid_at, 'receipt', r.number) ORDER BY i.created_at DESC)
  FROM platform.invoices i LEFT JOIN platform.receipts r ON r.invoice_id = i.id WHERE i.business_id = p_business_id), '[]'::jsonb);
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_billing_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_billing_history(uuid) TO authenticated;
GRANT USAGE ON SCHEMA platform TO cacu_runtime;
GRANT EXECUTE ON FUNCTION platform.open_checkout(uuid, uuid, uuid, text, text), platform.attach_checkout(text, text),
 platform.invoice_for(uuid, uuid, text), platform.record_billing_event(text, text, text, jsonb),
 platform.apply_verified_payment(text, bigint, text, timestamptz, text, text) TO cacu_runtime;
