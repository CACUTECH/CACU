-- CACU plans, entitlements and subscriptions (Doc 14, Doc 07 M-09 part 1). Plans are General (BASE), Oga (GROW)
-- and Chairman (TOP), owner decision of 2 November 2026; there is no free or pilot plan. Prices and limits are data,
-- edited by CACU staff without a release and audited (SUB-R04). Tenant roles cannot read or write these tables
-- (SUB-R02); members see their own plan through public.business_plan. A business with no subscription row is
-- unbilled and keeps today's behaviour until billing launches; enforcement applies once a subscription exists.
-- Paystack collection, billing events, CACU invoices and usage counters follow in the next slice.
SET LOCAL search_path = public, pg_catalog;

CREATE SCHEMA platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC, anon, authenticated;

CREATE TABLE platform.plans (
 code text PRIMARY KEY CHECK (code IN ('BASE','GROW','TOP')),
 display_name text NOT NULL UNIQUE,
 rank smallint NOT NULL UNIQUE,
 monthly_price_kobo bigint NOT NULL CHECK (monthly_price_kobo > 0),
 -- NULL until annual prices are confirmed (Doc 14 open question); monthly billing only.
 annual_price_kobo bigint CHECK (annual_price_kobo > 0),
 currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per plan and key. JSON null means unlimited; a missing row means the plan does not include it.
CREATE TABLE platform.plan_entitlements (
 plan_code text NOT NULL REFERENCES platform.plans(code),
 key text NOT NULL CHECK (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
 value jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (plan_code, key)
);

CREATE TABLE platform.config_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 table_name text NOT NULL,
 row_key jsonb NOT NULL,
 old_value jsonb,
 new_value jsonb,
 actor text NOT NULL DEFAULT current_user,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION platform.audit_config() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
 INSERT INTO platform.config_changes(table_name, row_key, old_value, new_value)
 VALUES (TG_TABLE_NAME,
         CASE TG_TABLE_NAME WHEN 'plans' THEN jsonb_build_object('code', r->'code')
              ELSE jsonb_build_object('plan_code', r->'plan_code', 'key', r->'key') END,
         CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
         CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
 RETURN coalesce(NEW, OLD);
END $$;

INSERT INTO platform.plans(code, display_name, rank, monthly_price_kobo) VALUES
 ('BASE', 'General', 1, 150000),
 ('GROW', 'Oga', 2, 600000),
 ('TOP', 'Chairman', 3, 1500000);

-- Doc 14 entitlement matrix. Prices and the Hybrid rule are owner-approved; the other limits are proposals to
-- confirm after the first paying businesses.
INSERT INTO platform.plan_entitlements(plan_code, key, value)
SELECT p.code, e.key, CASE p.code WHEN 'BASE' THEN e.base WHEN 'GROW' THEN e.grow ELSE e.top END
FROM platform.plans p CROSS JOIN (VALUES
 ('module.modes',            '["PRODUCT","SERVICE"]'::jsonb, '["PRODUCT","SERVICE"]'::jsonb, '["PRODUCT","SERVICE","HYBRID"]'::jsonb),
 ('users.max',               '2', '5', '15'),
 ('outlets.max',             '1', '2', '5'),
 ('businesses.max_owned',    '1', '3', '10'),
 ('module.core',             'true', 'true', 'true'),
 ('catalog.max_items',       '300', '3000', 'null'),
 ('module.purchasing',       'false', 'true', 'true'),
 ('module.transfers',        'false', 'true', 'true'),
 ('module.advanced_stock',   'false', 'false', 'true'),
 ('module.bookings',         'true', 'true', 'true'),
 ('module.booking_reminders','false', 'true', 'true'),
 ('module.job_costing',      'false', 'false', 'true'),
 ('reports.core',            'true', 'true', 'true'),
 ('reports.advanced',        'false', 'true', 'true'),
 ('reports.profitability',   'false', 'false', 'true'),
 ('module.offline',          'true', 'true', 'true'),
 ('module.custom_roles',     'false', 'true', 'true'),
 ('ai.queries_per_month',    '0', '100', '500'),
 ('module.funding',          '"score"', '"improvement_plan"', '"lender_pack"'),
 ('module.payroll',          '"none"', '"staff_directory"', '"payroll"'),
 ('messages.per_month',      '0', '100', '300'),
 ('storage.mb',              '500', '5120', '20480'),
 ('module.export',           'true', 'true', 'true'),
 ('support.tier',            '"in_app"', '"standard"', '"priority"'),
 ('module.api',              'false', 'false', 'false')
) AS e(key, base, grow, top);

CREATE TRIGGER plans_audit AFTER INSERT OR UPDATE OR DELETE ON platform.plans
 FOR EACH ROW EXECUTE FUNCTION platform.audit_config();
CREATE TRIGGER plan_entitlements_audit AFTER INSERT OR UPDATE OR DELETE ON platform.plan_entitlements
 FOR EACH ROW EXECUTE FUNCTION platform.audit_config();

-- Doc 14 lifecycle. trialing and incomplete (chosen, first payment not yet verified) come before active; past_due
-- and grace keep full access; suspended, cancelled (after period end) and closed are read-only (SUB-10, SUB-11).
CREATE TABLE platform.subscriptions (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 plan_code text NOT NULL REFERENCES platform.plans(code),
 status text NOT NULL CHECK (status IN ('trialing','incomplete','active','past_due','grace','suspended','cancelled','closed')),
 billing_interval text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly','annual')),
 current_period_start timestamptz,
 current_period_end timestamptz,
 grace_ends_at timestamptz,
 scheduled_plan_code text REFERENCES platform.plans(code),
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);

CREATE TABLE platform.subscription_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 from_plan text,
 to_plan text NOT NULL,
 from_status text,
 to_status text NOT NULL,
 actor_kind text NOT NULL CHECK (actor_kind IN ('owner','system','staff')),
 actor_id uuid,
 reason text NOT NULL CHECK (length(btrim(reason)) > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_changes_business_idx ON platform.subscription_changes(business_id, created_at);

-- Every subscription write must say who and why, through transaction settings:
--   SET LOCAL platform.actor_kind = 'staff'; SET LOCAL platform.reason = '...'; (optional platform.actor_id)
CREATE FUNCTION platform.record_subscription_change() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
 kind text := coalesce(nullif(current_setting('platform.actor_kind', true), ''), 'system');
 why text := nullif(btrim(coalesce(current_setting('platform.reason', true), '')), '');
BEGIN
 IF why IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF NEW.business_id <> OLD.business_id THEN RAISE EXCEPTION 'SUBSCRIPTION_BUSINESS_FIXED' USING ERRCODE = '22023'; END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
 END IF;
 INSERT INTO platform.subscription_changes(business_id, from_plan, to_plan, from_status, to_status, actor_kind, actor_id, reason)
 VALUES (NEW.business_id,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.plan_code END, NEW.plan_code,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
         kind, nullif(current_setting('platform.actor_id', true), '')::uuid, why);
 RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_record_change BEFORE INSERT OR UPDATE ON platform.subscriptions
 FOR EACH ROW EXECUTE FUNCTION platform.record_subscription_change();
-- Subscription history is kept forever (SUB-R03, SUB-R07); a business that leaves is closed, never deleted.
CREATE FUNCTION platform.refuse_delete() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'PLATFORM_HISTORY_IS_KEPT' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER subscription_changes_append_only BEFORE UPDATE OR DELETE ON platform.subscription_changes
 FOR EACH ROW EXECUTE FUNCTION platform.refuse_delete();
CREATE TRIGGER subscriptions_no_delete BEFORE DELETE ON platform.subscriptions
 FOR EACH ROW EXECUTE FUNCTION platform.refuse_delete();

-- The one entitlement check (Doc 14). SQL NULL: the business has no subscription yet (unbilled). JSON null: unlimited.
CREATE FUNCTION platform.entitlement(p_business_id uuid, p_key text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(e.value, 'false'::jsonb)
   FROM platform.subscriptions s
   LEFT JOIN platform.plan_entitlements e ON e.plan_code = s.plan_code AND e.key = p_key
  WHERE s.business_id = p_business_id;
$$;

-- Suspended, cancelled and closed businesses are read-only except receipts, transfer confirmations and exports,
-- which callers allow explicitly (SUB-10). Unbilled businesses keep full access until billing launches.
CREATE FUNCTION platform.writes_allowed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce((SELECT status NOT IN ('suspended','cancelled','closed') FROM platform.subscriptions WHERE business_id = p_business_id), true);
$$;

-- Hybrid mode only on plans whose module.modes includes it (Chairman). Checked on the business row, so the
-- browser, the API and direct Data API writes all meet it; and on the subscription, so a downgrade cannot leave a
-- Hybrid business on a plan without it (SUB-06: choose Product or Service first).
CREATE FUNCTION platform.business_mode_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE modes jsonb;
BEGIN
 IF NEW.business_type IS DISTINCT FROM OLD.business_type THEN
  modes := platform.entitlement(NEW.id, 'module.modes');
  IF modes IS NOT NULL AND NOT (modes ? NEW.business_type) THEN
   RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001',
    DETAIL = format('%s mode is not included in this business''s plan', NEW.business_type);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER businesses_plan_mode BEFORE UPDATE OF business_type ON public.businesses
 FOR EACH ROW EXECUTE FUNCTION platform.business_mode_guard();

CREATE FUNCTION platform.subscription_mode_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE mode text;
BEGIN
 SELECT business_type INTO mode FROM public.businesses WHERE id = NEW.business_id FOR SHARE;
 IF NOT EXISTS (SELECT FROM platform.plan_entitlements
                 WHERE plan_code = NEW.plan_code AND key = 'module.modes' AND value ? mode) THEN
  RAISE EXCEPTION 'PLAN_LIMIT module.modes' USING ERRCODE = 'P0001',
   DETAIL = format('Switch the business out of %s mode before moving to this plan', mode);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscriptions_plan_mode BEFORE INSERT OR UPDATE OF plan_code ON platform.subscriptions
 FOR EACH ROW EXECUTE FUNCTION platform.subscription_mode_guard();

ALTER TABLE platform.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.config_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.subscription_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC, anon, authenticated;

-- Read-only views for the app. Plans are public to signed-in users (the plan picker); a business's own plan is
-- visible to its active members.
CREATE FUNCTION public.billing_plans() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'code', p.code, 'name', p.display_name, 'monthly_price_kobo', p.monthly_price_kobo,
   'annual_price_kobo', p.annual_price_kobo, 'currency', p.currency,
   'entitlements', (SELECT jsonb_object_agg(e.key, e.value) FROM platform.plan_entitlements e WHERE e.plan_code = p.code))
   ORDER BY p.rank), '[]'::jsonb)
 FROM platform.plans p WHERE p.active;
$$;

CREATE FUNCTION public.business_plan(p_business_id uuid) RETURNS jsonb
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
  'entitlements', (SELECT jsonb_object_agg(e.key, e.value) FROM platform.plan_entitlements e WHERE e.plan_code = s.plan_code));
END $$;

REVOKE ALL ON FUNCTION public.billing_plans(), public.business_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_plans(), public.business_plan(uuid) TO authenticated;
