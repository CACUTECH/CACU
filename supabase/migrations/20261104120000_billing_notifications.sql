-- Billing reminders by email (Resend) and SMS or WhatsApp (Termii): Doc 14 SUB-04, SUB-08, SUB-09, SUB-10 and the
-- trial reminders. An hourly job adds what is due to an outbox, once per event and channel; the notification
-- operator claims, sends and records each one. Emails go to the business's active owners; SMS to the business phone.
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE platform.notifications (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 kind text NOT NULL CHECK (kind IN ('trial_ending', 'renewal_due', 'card_declined', 'payment_due', 'suspended')),
 channel text NOT NULL CHECK (channel IN ('email', 'sms')),
 dedupe_key text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
 attempts smallint NOT NULL DEFAULT 0,
 provider_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 UNIQUE (dedupe_key, channel)
);
CREATE INDEX notifications_queue_idx ON platform.notifications(status, created_at);
ALTER TABLE platform.notifications ENABLE ROW LEVEL SECURITY;

-- Adds every reminder that is due now. Each event has a stable key, so reruns add nothing twice.
CREATE FUNCTION platform.queue_notifications(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE added integer;
BEGIN
 WITH due(business_id, kind, dedupe_key, details) AS (
  -- Trial reminders four days and one day before the end (SUB-01).
  SELECT s.business_id, 'trial_ending', 'trial_ending:' || s.business_id || ':' || s.current_period_end::date || ':' || d.days,
         jsonb_build_object('plan', p.display_name, 'ends_at', s.current_period_end)
    FROM platform.subscriptions s JOIN platform.plans p ON p.code = s.plan_code
    CROSS JOIN (VALUES (4), (1)) d(days)
   WHERE s.status = 'trialing' AND s.current_period_end > p_now AND s.current_period_end <= p_now + make_interval(days => d.days)
     AND (d.days = 1 OR s.current_period_end > p_now + interval '1 day')
  UNION ALL
  -- A renewal invoice was issued (SUB-04).
  SELECT i.business_id, 'renewal_due', 'renewal_due:' || i.number,
         jsonb_build_object('plan', p.display_name, 'total_kobo', i.total_kobo, 'due_at', i.period_start,
                            'card', EXISTS (SELECT FROM platform.payment_methods m WHERE m.business_id = i.business_id))
    FROM platform.invoices i JOIN platform.plans p ON p.code = i.plan_code
   WHERE i.kind = 'renewal' AND i.status = 'open'
  UNION ALL
  -- Each declined card charge while the renewal is still unpaid (SUB-08).
  SELECT i.business_id, 'card_declined', 'card_declined:' || a.reference,
         jsonb_build_object('total_kobo', i.total_kobo, 'attempt', a.attempt)
    FROM platform.charge_attempts a JOIN platform.invoices i ON i.id = a.invoice_id
   WHERE a.outcome = 'declined' AND i.status = 'open'
  UNION ALL
  -- Payment due during grace (SUB-09).
  SELECT s.business_id, 'payment_due', 'payment_due:' || s.business_id || ':' || coalesce(s.grace_ends_at::date::text, ''),
         jsonb_build_object('plan', p.display_name, 'pay_by', coalesce(s.grace_ends_at, s.current_period_end))
    FROM platform.subscriptions s JOIN platform.plans p ON p.code = s.plan_code
   WHERE s.status IN ('incomplete', 'past_due', 'grace')
  UNION ALL
  -- Read-only (SUB-10).
  SELECT s.business_id, 'suspended', 'suspended:' || s.business_id || ':' || coalesce(s.current_period_end::date::text, ''),
         jsonb_build_object('plan', p.display_name)
    FROM platform.subscriptions s JOIN platform.plans p ON p.code = s.plan_code
   WHERE s.status = 'suspended'
 )
 INSERT INTO platform.notifications(business_id, kind, channel, dedupe_key, details, created_at)
 SELECT due.business_id, due.kind, c.channel, due.dedupe_key, due.details, p_now
   FROM due CROSS JOIN (VALUES ('email'), ('sms')) c(channel)
   JOIN public.businesses b ON b.id = due.business_id
  WHERE c.channel = 'email' OR nullif(btrim(coalesce(b.phone_number, '')), '') IS NOT NULL
 ON CONFLICT (dedupe_key, channel) DO NOTHING;
 GET DIAGNOSTICS added = ROW_COUNT;
 RETURN added;
END $$;

-- The operator's batch for the channels it can send: queued, or failed or stuck in sending for an hour, up to three
-- attempts. Reminders older than three days are dropped as stale rather than sent late. Returns what each message
-- needs: the business name, the owners' emails or the business phone.
CREATE FUNCTION platform.claim_notifications(p_channels text[], p_limit integer DEFAULT 50, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE claimed jsonb;
BEGIN
 UPDATE platform.notifications SET status = 'skipped', last_error = 'stale'
  WHERE status IN ('queued', 'failed', 'sending') AND created_at < p_now - interval '3 days';
 WITH batch AS (
  SELECT n.id FROM platform.notifications n
   WHERE n.channel = ANY (p_channels) AND n.attempts < 3
     AND (n.status = 'queued' OR (n.status IN ('failed', 'sending') AND n.claimed_at < p_now - interval '1 hour'))
   ORDER BY n.created_at, n.id LIMIT least(greatest(p_limit, 1), 200) FOR UPDATE SKIP LOCKED
 ), marked AS (
  UPDATE platform.notifications n SET status = 'sending', attempts = n.attempts + 1, claimed_at = p_now
    FROM batch WHERE n.id = batch.id RETURNING n.*
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'channel', m.channel, 'details', m.details,
   'business', b.name, 'phone', CASE WHEN m.channel = 'sms' THEN b.phone_number END,
   'emails', CASE WHEN m.channel = 'email' THEN (SELECT coalesce(jsonb_agg(DISTINCT lower(u.email)), '[]'::jsonb)
     FROM public.memberships ms JOIN auth.users u ON u.id = ms.user_id
    WHERE ms.business_id = m.business_id AND ms.is_active AND ms.role::text = 'owner' AND u.email IS NOT NULL) END) ORDER BY m.id), '[]'::jsonb)
   INTO claimed FROM marked m JOIN public.businesses b ON b.id = m.business_id;
 RETURN claimed;
END $$;

CREATE FUNCTION platform.finish_notification(p_id bigint, p_sent boolean, p_provider_id text, p_error text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 UPDATE platform.notifications
    SET status = CASE WHEN p_sent THEN 'sent' WHEN p_error = 'no_recipient' THEN 'skipped' ELSE 'failed' END,
        sent_at = CASE WHEN p_sent THEN now() END, provider_id = left(p_provider_id, 120), last_error = left(p_error, 200)
  WHERE id = p_id AND status = 'sending';
$$;

CREATE OR REPLACE FUNCTION ops.run_job(p_job text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE started timestamptz := clock_timestamp(); n integer; message text;
BEGIN
 IF p_job NOT IN ('billing.end_trials', 'billing.issue_renewals', 'billing.end_periods', 'billing.suspend_unpaid',
                  'billing.queue_notifications') THEN
  RAISE EXCEPTION 'UNKNOWN_JOB %', p_job USING ERRCODE = '22023';
 END IF;
 BEGIN
  n := CASE p_job WHEN 'billing.end_trials' THEN platform.end_trials()
                  WHEN 'billing.issue_renewals' THEN platform.issue_renewals()
                  WHEN 'billing.end_periods' THEN platform.end_periods()
                  WHEN 'billing.queue_notifications' THEN platform.queue_notifications()
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
REVOKE ALL ON FUNCTION platform.queue_notifications(timestamptz), platform.claim_notifications(text[], integer, timestamptz),
 platform.finish_notification(bigint, boolean, text, text), ops.run_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.claim_notifications(text[], integer, timestamptz), platform.finish_notification(bigint, boolean, text, text)
 TO cacu_runtime;

DO $schedule$
BEGIN
 IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('cacu-billing-queue-notifications', '47 * * * *', $job$SELECT ops.run_job('billing.queue_notifications')$job$);
 END IF;
END
$schedule$;
