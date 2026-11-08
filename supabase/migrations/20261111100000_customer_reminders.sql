-- Customer notifications, parts 2 and 3 (Doc 10 E20; owner decisions of 7 November 2026).
--  * overdue invoice reminders, when the business turns them on (Settings › Notifications): the day before an unpaid
--    invoice is due, on the due date, and 7 days after, while something is still owed. Staff can also send one from an
--    unpaid invoice at any time;
--  * booking messages, on plans with booking reminders (module.booking_reminders: Oga and Chairman) when the business turns
--    them on: a confirmation when a booking is made for a later time, and a
--    reminder about a day before (for bookings made more than a day ahead);
--  * a message goes by text when the customer has a Nigerian mobile number and the month's texts are not used up,
--    otherwise by email when there is an address. An hourly job queues what is due, between 9:00 and 20:00 in Lagos.
SET LOCAL search_path = public, pg_catalog;

-- By text if possible, else by email; returns what was queued ('sms', 'email') or why nothing was ('no_contact', 'limit',
-- 'already_queued').
CREATE FUNCTION platform.message_customer(p_business_id uuid, p_kind text, p_phone text, p_email text, p_dedupe_key text,
  p_source_id uuid, p_details jsonb, p_actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE phone text := platform.nigerian_number(p_phone); email text := lower(btrim(coalesce(p_email, ''))); result text;
BEGIN
 IF email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(email) > 254 THEN email := NULL; END IF;
 IF phone IS NOT NULL THEN
  result := platform.queue_customer_message(p_business_id, p_kind, 'sms', phone, p_dedupe_key, p_source_id, p_details, p_actor);
  IF result = 'queued' THEN RETURN 'sms'; END IF;
  IF result <> 'allowance_used' OR email IS NULL THEN RETURN CASE WHEN result = 'allowance_used' THEN 'no_contact' ELSE result END; END IF;
 END IF;
 IF email IS NULL THEN RETURN 'no_contact'; END IF;
 result := platform.queue_customer_message(p_business_id, p_kind, 'email', email, p_dedupe_key, p_source_id, p_details, p_actor);
 RETURN CASE WHEN result = 'queued' THEN 'email' ELSE result END;
END $$;

-- What is still owed on an invoice: issued on the books, its total less what has been assigned to clear it; otherwise
-- its total less successful payments.
CREATE FUNCTION platform.invoice_owed(p_business_id uuid, p_invoice_id uuid) RETURNS numeric
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT greatest(i.total - CASE WHEN d.transaction_id IS NOT NULL
     THEN coalesce((SELECT sum(a.amount) FROM accounting.assignment a WHERE a.business_id = i.business_id AND a.assigned_id = d.transaction_id), 0)
     ELSE coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.business_id = i.business_id AND p.invoice_id = i.id AND p.status = 'success'), 0) END, 0)
   FROM public.invoices i
   LEFT JOIN accounting.document_map d ON d.business_id = i.business_id AND d.source_type = 'invoice' AND d.source_id = i.id
  WHERE i.business_id = p_business_id AND i.id = p_invoice_id
$$;

CREATE FUNCTION platform.invoice_reminder(p_business_id uuid, p_invoice_id uuid, p_stage text, p_dedupe_key text, p_actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE i record; owed numeric;
BEGIN
 SELECT v.id, v.invoice_number, v.due_date, v.status, v.type, to_jsonb(c)->>'phone_number' AS phone_number, to_jsonb(c)->>'email' AS email INTO i
   FROM public.invoices v LEFT JOIN public.customers c ON c.business_id = v.business_id AND c.id = v.customer_id
  WHERE v.business_id = p_business_id AND v.id = p_invoice_id;
 IF NOT FOUND OR i.type IS DISTINCT FROM 'Invoice' OR i.status NOT IN ('sent', 'overdue') THEN RETURN 'not_due'; END IF;
 owed := platform.invoice_owed(p_business_id, p_invoice_id);
 IF owed <= 0 THEN RETURN 'paid'; END IF;
 RETURN platform.message_customer(p_business_id, 'invoice_reminder', i.phone_number, i.email, p_dedupe_key, p_invoice_id,
   jsonb_build_object('number', i.invoice_number, 'outstanding', owed, 'due_date', i.due_date, 'stage', p_stage), p_actor);
END $$;

-- Staff send a reminder for an unpaid invoice now. A request key makes a retry queue nothing twice.
CREATE FUNCTION public.send_invoice_reminder(p_business_id uuid, p_invoice_id uuid, p_request_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE due date; today date := (now() AT TIME ZONE 'Africa/Lagos')::date; result text;
BEGIN
 IF auth.uid() IS NULL OR NOT authz.has_permission(p_business_id, 'invoices.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501'; END IF;
 SELECT due_date INTO due FROM public.invoices WHERE business_id = p_business_id AND id = p_invoice_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
 result := platform.invoice_reminder(p_business_id, p_invoice_id,
   CASE WHEN due IS NULL OR due > today THEN 'before' WHEN due = today THEN 'due' ELSE 'after' END, 'invoice_reminder:' || p_request_key, auth.uid());
 RETURN jsonb_build_object('result', result, 'texts', platform.text_quota(p_business_id));
END $$;

-- Who a booking's messages go to: the linked customer's phone and email, else the phone typed on the booking.
CREATE FUNCTION platform.booking_message(p_business_id uuid, p_booking_id uuid, p_kind text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b record;
BEGIN
 SELECT a.id, a.scheduled_at, a.status, coalesce(nullif(to_jsonb(c)->>'phone_number', ''), a.customer_phone) AS phone, to_jsonb(c)->>'email' AS email,
        coalesce((SELECT s.name FROM public.catalog_items s WHERE s.business_id = a.business_id AND s.id = a.service_id), a.title) AS service
   INTO b FROM public.appointments a LEFT JOIN public.customers c ON c.business_id = a.business_id AND c.id = a.customer_id
  WHERE a.business_id = p_business_id AND a.id = p_booking_id;
 IF NOT FOUND OR b.status <> 'confirmed' THEN RETURN 'not_due'; END IF;
 RETURN platform.message_customer(p_business_id, p_kind, b.phone, b.email, p_kind || ':' || b.id || ':' || b.scheduled_at, b.id,
   jsonb_build_object('service', b.service, 'at', b.scheduled_at), NULL);
END $$;

-- A confirmation for each new booking at a later time, when the business has booking messages on.
CREATE FUNCTION platform.booking_confirmation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.status = 'confirmed' AND NEW.scheduled_at > now()
    AND coalesce((SELECT booking_reminders FROM public.notification_settings WHERE business_id = NEW.business_id), false)
    AND coalesce(platform.entitlement(NEW.business_id, 'module.booking_reminders') = 'true'::jsonb, true) THEN
  PERFORM platform.booking_message(NEW.business_id, NEW.id, 'booking_confirmation');
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER booking_confirmation AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION platform.booking_confirmation();

-- The hourly job: invoice reminders by Lagos date and booking reminders about a day ahead, once each.
CREATE FUNCTION platform.queue_customer_reminders(p_now timestamptz DEFAULT now()) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE today date := (p_now AT TIME ZONE 'Africa/Lagos')::date; hour integer := extract(hour FROM p_now AT TIME ZONE 'Africa/Lagos');
 r record; stage text; added integer := 0;
BEGIN
 IF hour < 9 OR hour >= 20 THEN RETURN 0; END IF;
 FOR r IN SELECT i.business_id, i.id, i.due_date FROM public.invoices i
           JOIN public.notification_settings s ON s.business_id = i.business_id AND s.invoice_reminders
          WHERE i.type = 'Invoice' AND i.status IN ('sent', 'overdue') AND i.due_date IN (today + 1, today, today - 7)
            AND platform.writes_allowed(i.business_id) LOOP
  stage := CASE WHEN r.due_date > today THEN 'before' WHEN r.due_date = today THEN 'due' ELSE 'after' END;
  IF platform.invoice_reminder(r.business_id, r.id, stage, 'invoice_reminder:' || r.id || ':' || stage, NULL) IN ('sms', 'email') THEN added := added + 1; END IF;
 END LOOP;
 FOR r IN SELECT a.business_id, a.id FROM public.appointments a
           JOIN public.notification_settings s ON s.business_id = a.business_id AND s.booking_reminders
          WHERE a.status = 'confirmed' AND a.scheduled_at > p_now + interval '2 hours' AND a.scheduled_at <= p_now + interval '26 hours'
            AND a.created_at <= a.scheduled_at - interval '24 hours' AND platform.writes_allowed(a.business_id)
            AND coalesce(platform.entitlement(a.business_id, 'module.booking_reminders') = 'true'::jsonb, true) LOOP
  IF platform.booking_message(r.business_id, r.id, 'booking_reminder') IN ('sms', 'email') THEN added := added + 1; END IF;
 END LOOP;
 RETURN added;
END $$;

REVOKE ALL ON FUNCTION platform.message_customer(uuid, text, text, text, text, uuid, jsonb, uuid), platform.invoice_owed(uuid, uuid),
 platform.invoice_reminder(uuid, uuid, text, text, uuid), platform.booking_message(uuid, uuid, text), platform.queue_customer_reminders(timestamptz)
 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_invoice_reminder(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_invoice_reminder(uuid, uuid, uuid) TO authenticated;

-- The job runner learns the new job; the schedule runs it hourly.
-- reminder job begin (only where the job runner exists: every hosted project)
DO $jobs$ BEGIN
 IF to_regprocedure('ops.run_job(text)') IS NOT NULL THEN
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION ops.run_job(p_job text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE started timestamptz := clock_timestamp(); n integer; message text;
BEGIN
 IF p_job NOT IN ('billing.end_trials', 'billing.issue_renewals', 'billing.end_periods', 'billing.suspend_unpaid',
                  'billing.queue_notifications', 'messages.queue_reminders') THEN
  RAISE EXCEPTION 'UNKNOWN_JOB %', p_job USING ERRCODE = '22023';
 END IF;
 BEGIN
  n := CASE p_job WHEN 'billing.end_trials' THEN platform.end_trials()
                  WHEN 'billing.issue_renewals' THEN platform.issue_renewals()
                  WHEN 'billing.end_periods' THEN platform.end_periods()
                  WHEN 'billing.queue_notifications' THEN platform.queue_notifications()
                  WHEN 'messages.queue_reminders' THEN platform.queue_customer_reminders()
                  ELSE platform.suspend_unpaid() END;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
  INSERT INTO ops.job_runs(job, started_at, ok, error) VALUES (p_job, started, false, left(message, 1000));
  RETURN jsonb_build_object('job', p_job, 'ok', false, 'error', left(message, 1000));
 END;
 INSERT INTO ops.job_runs(job, started_at, ok, changed) VALUES (p_job, started, true, n);
 RETURN jsonb_build_object('job', p_job, 'ok', true, 'changed', n);
END $f$$fn$;
  REVOKE ALL ON FUNCTION ops.run_job(text) FROM PUBLIC, anon, authenticated;
  IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
   PERFORM cron.schedule('cacu-messages-queue-reminders', '12 * * * *', $job$SELECT ops.run_job('messages.queue_reminders')$job$);
  END IF;
 END IF;
END $jobs$;
-- reminder job end
