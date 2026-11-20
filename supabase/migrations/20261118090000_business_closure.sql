-- Closing a business (Doc 10 E22 part 3; Doc 03 FR-210; Doc 07 retention classes and DB-004; Doc 08 GAP-10; Doc 16
-- data subject rights). Owner decision of 9 November 2026: 90 days to export before personal data is removed.
--  * only the Owner closes, typing the business's name. At once: the business is read-only (every write gate that
--    honours platform.writes_allowed), staff lose access, pay links stop working and billing stops renewing. The Owner
--    keeps read-only access to export, and can reopen within the 90 days, which restores the staff who lost access;
--  * after 90 days a recorded job removes personal details not needed for the books (R-PER: customer and supplier
--    contact details) and operational data (R-OPS: message logs, notifications, AI usage records, parked carts,
--    invitations, the sealed Paystack key, export files);
--  * financial and employment records (R-FIN, R-EMP) stay, read-only, until retain_until (the end of the closing year
--    plus six years), and the Owner keeps read-only access to them, as tax and company law may ask for them; deleting
--    them then is a later, separately recorded job. Nothing is deleted before.
SET LOCAL search_path = platform, public, pg_catalog;

CREATE TABLE platform.business_closure (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 status text NOT NULL CHECK (status IN ('closed', 'reopened', 'purged')),
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 closed_by uuid NOT NULL,
 closed_at timestamptz NOT NULL,
 purge_after timestamptz NOT NULL,
 retain_until date NOT NULL,
 staff_removed uuid[] NOT NULL DEFAULT '{}',
 previous_subscription_status text,
 reopened_by uuid, reopened_at timestamptz,
 purged_at timestamptz,
 CHECK (status <> 'purged' OR purged_at IS NOT NULL)
);
CREATE INDEX business_closure_due ON platform.business_closure (purge_after) WHERE status = 'closed';
-- Every closing, reopening and removal, kept as CACU's own record.
CREATE TABLE platform.business_closure_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 event text NOT NULL CHECK (event IN ('closed', 'reopened', 'purged')),
 actor_id uuid,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform.business_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.business_closure_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform.business_closure, platform.business_closure_events FROM PUBLIC, anon, authenticated;

-- A closed business, or one whose personal data has been removed, takes no writes: every gate that asks this refuses.
CREATE OR REPLACE FUNCTION platform.writes_allowed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce((SELECT status NOT IN ('suspended','cancelled','closed') FROM platform.subscriptions WHERE business_id = p_business_id), true)
  AND NOT EXISTS (SELECT FROM platform.business_closure c WHERE c.business_id = p_business_id AND c.status IN ('closed', 'purged'));
$$;

-- The table guard says which read-only it is, and lets the removal job (inside its own transaction) clear contact details.
CREATE OR REPLACE FUNCTION platform.read_only_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 -- A legacy receipt against an existing invoice records its income event here; collecting what is owed stays open.
 IF TG_TABLE_NAME = 'financial_transactions' AND to_jsonb(NEW)->>'reference_type' IS NOT DISTINCT FROM 'Payment' THEN RETURN NEW; END IF;
 -- Deactivating staff and other membership edits stay open; only bringing someone back is a new seat.
 -- (Nested: PL/pgSQL does not short-circuit, and other tables have no is_active.)
 IF TG_TABLE_NAME = 'memberships' AND TG_OP = 'UPDATE' THEN
  IF NOT (NEW.is_active AND NOT OLD.is_active) THEN RETURN NEW; END IF;
 END IF;
 IF current_setting('platform.closure_purge', true) = NEW.business_id::text THEN RETURN NEW; END IF;
 IF NOT platform.writes_allowed(NEW.business_id) THEN
  IF EXISTS (SELECT FROM platform.business_closure c WHERE c.business_id = NEW.business_id AND c.status IN ('closed', 'purged')) THEN
   RAISE EXCEPTION 'BUSINESS_CLOSED' USING ERRCODE = 'P0001', HINT = 'This business is closed; its records are read-only';
  END IF;
  RAISE EXCEPTION 'SUBSCRIPTION_READ_ONLY' USING ERRCODE = 'P0001',
   HINT = 'The workspace is read-only until the subscription is paid; payments received and exports still work';
 END IF;
 RETURN NEW;
END $$;

-- What the app shows a member: whether the business is closed, until when it can be exported or reopened.
CREATE FUNCTION public.business_closure_status(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c platform.business_closure%ROWTYPE; is_owner boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active) THEN
  RETURN NULL;
 END IF;
 SELECT * INTO c FROM platform.business_closure WHERE business_id = p_business_id;
 is_owner := EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active AND role::text = 'owner');
 RETURN jsonb_build_object('closed', FOUND AND c.status = 'closed', 'closed_at', c.closed_at, 'purge_after', c.purge_after,
  'can_reopen', FOUND AND c.status = 'closed' AND c.purge_after > now() AND is_owner, 'is_owner', is_owner,
  'staff', (SELECT count(*) FROM public.memberships WHERE business_id = p_business_id AND is_active AND user_id <> auth.uid()));
END $$;

-- The Owner closes the business, typing its name.
CREATE FUNCTION public.close_business(p_business_id uuid, p_confirm_name text, p_reason text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; b public.businesses%ROWTYPE; removed uuid[]; previous text; closing timestamptz := now(); window_days int := 90;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner'], true);
 SELECT * INTO b FROM public.businesses WHERE id = p_business_id FOR UPDATE;
 IF lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(b.name)) THEN RAISE EXCEPTION 'CONFIRM_NAME_MISMATCH' USING ERRCODE = '22023'; END IF;
 IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT FROM platform.business_closure WHERE business_id = p_business_id AND status <> 'reopened') THEN
  RAISE EXCEPTION 'ALREADY_CLOSED' USING ERRCODE = '23514';
 END IF;
 -- Staff lose access at once; the Owner keeps read-only access to export or reopen.
 WITH ended AS (UPDATE public.memberships SET is_active = false
                 WHERE business_id = p_business_id AND is_active AND user_id <> actor RETURNING user_id)
 SELECT coalesce(array_agg(user_id), '{}') INTO removed FROM ended;
 -- Billing stops: no renewals for a closed business.
 SELECT status INTO previous FROM platform.subscriptions WHERE business_id = p_business_id;
 IF FOUND THEN
  PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', actor::text, true),
          set_config('platform.reason', 'Business closed by the owner', true);
  UPDATE platform.subscriptions SET status = 'closed', cancel_at_period_end = false, scheduled_plan_code = NULL WHERE business_id = p_business_id;
  IF to_regclass('platform.invoices') IS NOT NULL THEN
   UPDATE platform.invoices SET status = 'void' WHERE business_id = p_business_id AND status = 'open';
  END IF;
 END IF;
 -- Pay links stop working; payments already received stay in the books.
 IF to_regclass('accounting.payment_link') IS NOT NULL THEN
  UPDATE accounting.payment_link SET revoked_at = closing, revoked_by = actor WHERE business_id = p_business_id AND revoked_at IS NULL;
 END IF;
 INSERT INTO platform.business_closure (business_id, status, reason, closed_by, closed_at, purge_after, retain_until, staff_removed, previous_subscription_status)
  VALUES (p_business_id, 'closed', btrim(p_reason), actor, closing, closing + make_interval(days => window_days),
          make_date(extract(year FROM closing)::int + 7, 1, 1) - 1, removed, previous)
  ON CONFLICT (business_id) DO UPDATE SET status = 'closed', reason = EXCLUDED.reason, closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at,
   purge_after = EXCLUDED.purge_after, retain_until = EXCLUDED.retain_until, staff_removed = EXCLUDED.staff_removed,
   previous_subscription_status = EXCLUDED.previous_subscription_status, reopened_by = NULL, reopened_at = NULL;
 INSERT INTO platform.business_closure_events (business_id, event, actor_id, details)
  VALUES (p_business_id, 'closed', actor, jsonb_build_object('reason', btrim(p_reason), 'staff_removed', cardinality(removed)));
 RETURN public.business_closure_status(p_business_id);
END $$;

-- Within the 90 days the Owner reopens it: writes come back, and so do the staff who lost access when it closed.
CREATE FUNCTION public.reopen_business(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid; c platform.business_closure%ROWTYPE; restored int := 0;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner'], true);
 SELECT * INTO c FROM platform.business_closure WHERE business_id = p_business_id FOR UPDATE;
 IF NOT FOUND OR c.status <> 'closed' THEN RAISE EXCEPTION 'NOT_CLOSED' USING ERRCODE = '23514'; END IF;
 IF c.purge_after <= now() THEN RAISE EXCEPTION 'REOPEN_WINDOW_ENDED' USING ERRCODE = '23514'; END IF;
 UPDATE platform.business_closure SET status = 'reopened', reopened_by = actor, reopened_at = now() WHERE business_id = p_business_id;
 IF c.previous_subscription_status IS NOT NULL THEN
  PERFORM set_config('platform.actor_kind', 'owner', true), set_config('platform.actor_id', actor::text, true),
          set_config('platform.reason', 'Business reopened by the owner', true);
  UPDATE platform.subscriptions SET status = c.previous_subscription_status WHERE business_id = p_business_id;
 END IF;
 -- Plan seat limits still apply; anyone beyond them stays out and the owner can invite them again.
 UPDATE public.memberships SET is_active = true WHERE business_id = p_business_id AND user_id = ANY(c.staff_removed) AND NOT is_active;
 GET DIAGNOSTICS restored = ROW_COUNT;
 INSERT INTO platform.business_closure_events (business_id, event, actor_id, details)
  VALUES (p_business_id, 'reopened', actor, jsonb_build_object('staff_restored', restored));
 RETURN public.business_closure_status(p_business_id) || jsonb_build_object('staff_restored', restored);
END $$;
REVOKE ALL ON FUNCTION public.business_closure_status(uuid), public.close_business(uuid, text, text), public.reopen_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_closure_status(uuid), public.close_business(uuid, text, text), public.reopen_business(uuid) TO authenticated;

-- After the 90 days: personal details not needed for the books, and operational data, are removed. Financial and employment records stay until retain_until. Runtime only (the scheduled job).
CREATE FUNCTION platform.purge_closed_businesses(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; done integer := 0; counts jsonb; n bigint; target record;
BEGIN
 FOR c IN SELECT * FROM platform.business_closure WHERE status = 'closed' AND purge_after <= p_now ORDER BY purge_after LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
  PERFORM set_config('platform.closure_purge', c.business_id::text, true);
  counts := '{}'::jsonb;
  -- R-PER: contact details of customers and suppliers (whichever of these columns exist); their names stay on the
  -- invoices and bills they appear on.
  FOR target IN SELECT t.name, t.kind, string_agg(format('%I = NULL', col.column_name), ', ') AS sets
      FROM (VALUES ('customers', 'customers_cleared', ARRAY['email', 'phone_number', 'phone', 'address', 'notes', 'company']),
                   ('suppliers', 'suppliers_cleared', ARRAY['email', 'phone', 'phone_number', 'address'])) t(name, kind, cols)
      JOIN information_schema.columns col ON col.table_schema = 'public' AND col.table_name = t.name AND col.column_name = ANY(t.cols)
      GROUP BY t.name, t.kind LOOP
   EXECUTE format('UPDATE public.%I SET %s WHERE business_id = $1', target.name, target.sets) USING c.business_id;
   GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object(target.kind, n);
  END LOOP;
  -- R-OPS and secrets: whichever of these tables exist.
  FOR target IN SELECT * FROM (VALUES ('platform.customer_messages'), ('platform.notifications'), ('public.notifications'),
      ('public.notification_logs'), ('public.receipt_links'), ('public.parked_sales'), ('public.business_invitations'),
      ('ai_private.requests'), ('accounting.payment_provider'), ('accounting.data_export')) t(name) LOOP
   CONTINUE WHEN to_regclass(target.name) IS NULL;
   EXECUTE format('DELETE FROM %s WHERE business_id = $1', target.name) USING c.business_id;
   GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object(target.name, n);
  END LOOP;
  UPDATE platform.business_closure SET status = 'purged', purged_at = p_now WHERE business_id = c.business_id;
  INSERT INTO platform.business_closure_events (business_id, event, details) VALUES (c.business_id, 'purged', counts);
  PERFORM set_config('platform.closure_purge', '', true);
  done := done + 1;
 END LOOP;
 RETURN done;
END $$;
-- The job's dry run: how many are due.
CREATE FUNCTION platform.closures_due(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT count(*)::int FROM platform.business_closure WHERE status = 'closed' AND purge_after <= p_now;
$$;
REVOKE ALL ON FUNCTION platform.purge_closed_businesses(timestamptz), platform.closures_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.purge_closed_businesses(timestamptz), platform.closures_due(timestamptz) TO cacu_runtime;

-- The accounting API says which read-only it is.
CREATE FUNCTION platform.is_closed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT FROM platform.business_closure WHERE business_id = p_business_id AND status IN ('closed', 'purged'));
$$;
REVOKE ALL ON FUNCTION platform.is_closed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.is_closed(uuid) TO cacu_runtime;
