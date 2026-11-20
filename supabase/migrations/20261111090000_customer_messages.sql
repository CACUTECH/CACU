-- Customer notifications, part 1 (Doc 10 E20; owner decisions of 7 November 2026): receipts by email, SMS and public link.
--  * a business sends a sale's receipt to its customer by email (Resend) or text (Termii, SMS or WhatsApp per the
--    configured channel). Messages wait in platform.customer_messages; the notification operator sends them, as it does
--    CACU's billing reminders. The customer's address is kept only until the message is sent, and no longer than 30 days;
--  * texts come from a monthly allowance by plan (messages.texts_per_month: General 20, Oga 200, Chairman 1,000).
--    When it is used up a text is not queued; the receipt goes by email if an address was given, and the screen says so;
--  * a receipt link (/r/<token>) shows the business, the items, the totals and how it was paid, never the customer's
--    details. It keeps working until staff revoke it;
--  * notification settings (overdue invoice and booking reminders, parts 2 and 3) start off.
SET LOCAL search_path = public, pg_catalog;

INSERT INTO platform.plan_entitlements(plan_code, key, value) VALUES
 ('BASE', 'messages.texts_per_month', '20'), ('GROW', 'messages.texts_per_month', '200'), ('TOP', 'messages.texts_per_month', '1000')
ON CONFLICT (plan_code, key) DO UPDATE SET value = EXCLUDED.value;

CREATE TABLE public.notification_settings (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 invoice_reminders boolean NOT NULL DEFAULT false,
 booking_reminders boolean NOT NULL DEFAULT false,
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings FROM PUBLIC, anon, authenticated;

CREATE TABLE public.receipt_links (
 token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{64}$'),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 sale_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_by uuid,
 revoked_at timestamptz,
 CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX receipt_links_live ON public.receipt_links (business_id, sale_id) WHERE revoked_at IS NULL;
ALTER TABLE public.receipt_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_links FROM PUBLIC, anon, authenticated;

CREATE TABLE platform.customer_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 kind text NOT NULL CHECK (kind IN ('receipt', 'invoice_reminder', 'booking_confirmation', 'booking_reminder')),
 channel text NOT NULL CHECK (channel IN ('email', 'sms')),
 recipient text,
 shown_to text NOT NULL,
 dedupe_key text NOT NULL,
 source_id uuid,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
 attempts smallint NOT NULL DEFAULT 0,
 provider_id text,
 last_error text,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 UNIQUE (dedupe_key, channel)
);
CREATE INDEX customer_messages_queue ON platform.customer_messages (status, created_at);
CREATE INDEX customer_messages_business ON platform.customer_messages (business_id, created_at DESC);
CREATE INDEX customer_messages_source ON platform.customer_messages (business_id, source_id);
ALTER TABLE platform.customer_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform.customer_messages FROM PUBLIC, anon, authenticated;

-- {limit, used, remaining, resets_at}: texts this Lagos month. Businesses without a subscription get the General allowance.
CREATE FUNCTION platform.text_quota(p_business_id uuid, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE allowed jsonb := platform.entitlement(p_business_id, 'messages.texts_per_month'); cap integer; used integer;
 month_start timestamptz := date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
BEGIN
 cap := CASE WHEN jsonb_typeof(allowed) = 'number' THEN allowed::text::integer ELSE 20 END;
 SELECT count(*) INTO used FROM platform.customer_messages
  WHERE business_id = p_business_id AND channel = 'sms' AND status IN ('queued', 'sending', 'sent') AND created_at >= month_start;
 RETURN jsonb_build_object('limit', cap, 'used', used, 'remaining', greatest(cap - used, 0),
  'resets_at', (date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos') + interval '1 month') AT TIME ZONE 'Africa/Lagos');
END $$;

-- How a recipient is shown on screen after the message: a***@example.com, 0803***5678.
CREATE FUNCTION platform.masked(p_channel text, p_recipient text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN p_channel = 'email' THEN left(p_recipient, 1) || '***' || substring(p_recipient FROM position('@' IN p_recipient))
             ELSE '0' || substring(p_recipient FROM 4 FOR 3) || '***' || right(p_recipient, 4) END
$$;

-- 234XXXXXXXXXX, or null when it is not a Nigerian mobile number.
CREATE FUNCTION platform.nigerian_number(p_raw text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN d ~ '^0[0-9]{10}$' THEN '234' || substring(d FROM 2) WHEN d ~ '^234[0-9]{10}$' THEN d END
   FROM (SELECT regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') AS d) x
$$;

-- Adds a message to the outbox; returns 'queued', 'already_queued', 'allowance_used' (a text over the allowance) or
-- 'limit' (too many messages for one record or for the business today). Callers have already checked who may send.
CREATE FUNCTION platform.queue_customer_message(p_business_id uuid, p_kind text, p_channel text, p_recipient text, p_dedupe_key text,
  p_source_id uuid, p_details jsonb, p_actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer_messages:' || p_business_id, 0));
 IF EXISTS (SELECT FROM platform.customer_messages WHERE dedupe_key = p_dedupe_key AND channel = p_channel) THEN RETURN 'already_queued'; END IF;
 IF p_source_id IS NOT NULL AND (SELECT count(*) FROM platform.customer_messages WHERE business_id = p_business_id AND source_id = p_source_id
      AND channel = p_channel AND kind = p_kind) >= 5
    OR (SELECT count(*) FROM platform.customer_messages WHERE business_id = p_business_id AND created_at > now() - interval '1 day') >= 500 THEN
  RETURN 'limit';
 END IF;
 IF p_channel = 'sms' AND (platform.text_quota(p_business_id)->>'remaining')::integer = 0 THEN RETURN 'allowance_used'; END IF;
 INSERT INTO platform.customer_messages(business_id, kind, channel, recipient, shown_to, dedupe_key, source_id, details, created_by)
 VALUES (p_business_id, p_kind, p_channel, p_recipient, platform.masked(p_channel, p_recipient), p_dedupe_key, p_source_id, p_details, p_actor);
 RETURN 'queued';
END $$;

-- The live receipt link for a sale, made on first use.
CREATE FUNCTION platform.receipt_link(p_business_id uuid, p_sale_id uuid, p_actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE found text;
BEGIN
 SELECT token INTO found FROM public.receipt_links WHERE business_id = p_business_id AND sale_id = p_sale_id AND revoked_at IS NULL;
 IF found IS NULL THEN
  found := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.receipt_links(token, business_id, sale_id, created_by) VALUES (found, p_business_id, p_sale_id, p_actor);
 END IF;
 RETURN found;
END $$;

-- What a receipt link shows. Null for an unknown or revoked link.
CREATE FUNCTION platform.sale_receipt(p_business_id uuid, p_sale_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('business', jsonb_build_object('name', b.name, 'address', to_jsonb(b)->>'address', 'phone', to_jsonb(b)->>'phone_number'),
   'number', t.transaction_no, 'date', t.transaction_date::date, 'status', s.status, 'method', s.payment_method,
   'subtotal', s.subtotal, 'discount_total', s.discount_total, 'total', s.total, 'transfer_amount', s.transfer_amount,
   'cash_received', s.cash_received, 'change', s.change_given, 'refunded_total', s.refunded_total, 'deposit_applied', s.deposit_applied,
   'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', i.description, 'quantity', i.quantity, 'unit_price', i.unit_price,
              'discount', i.discount, 'total', i.line_total) ORDER BY i.description), '[]'::jsonb)
             FROM public.transaction_items i WHERE i.business_id = s.business_id AND i.transaction_id = s.id))
   FROM public.transactions s
   JOIN accounting.document_map d ON d.business_id = s.business_id AND d.source_id = s.id AND d.source_type = 'pos'
   JOIN accounting."transaction" t ON t.id = d.transaction_id AND t.business_id = d.business_id
   JOIN public.businesses b ON b.id = s.business_id
  WHERE s.business_id = p_business_id AND s.id = p_sale_id
$$;

-- Sends a sale's receipt: a link always, and an email and/or a text when an address is given. A request key makes a
-- retried send queue nothing twice. Allowed while a business is read-only, as receipts are (SUB-10).
CREATE FUNCTION public.share_receipt(p_business_id uuid, p_sale_id uuid, p_request_key uuid, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor uuid := auth.uid(); sale jsonb; token text; email text := lower(btrim(coalesce(p_email, ''))); phone text;
 details jsonb; by_email text; by_text text;
BEGIN
 IF actor IS NULL OR NOT authz.has_permission(p_business_id, 'sales.view') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501'; END IF;
 sale := platform.sale_receipt(p_business_id, p_sale_id);
 IF sale IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
 IF email <> '' AND (length(email) > 254 OR email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'EMAIL_INVALID' USING ERRCODE = '22023'; END IF;
 IF btrim(coalesce(p_phone, '')) <> '' THEN
  phone := platform.nigerian_number(p_phone);
  IF phone IS NULL THEN RAISE EXCEPTION 'PHONE_INVALID' USING ERRCODE = '22023'; END IF;
 END IF;
 token := platform.receipt_link(p_business_id, p_sale_id, actor);
 details := jsonb_build_object('number', sale->>'number', 'total', sale->>'total', 'token', token);
 IF phone IS NOT NULL THEN
  by_text := platform.queue_customer_message(p_business_id, 'receipt', 'sms', phone, 'receipt:' || p_request_key, p_sale_id, details, actor);
 END IF;
 IF email <> '' THEN
  by_email := platform.queue_customer_message(p_business_id, 'receipt', 'email', email, 'receipt:' || p_request_key, p_sale_id, details, actor);
 END IF;
 RETURN jsonb_build_object('token', token, 'email', by_email, 'text', by_text, 'texts', platform.text_quota(p_business_id));
END $$;

-- Stops a sale's receipt link working; sharing again makes a new one.
CREATE FUNCTION public.revoke_receipt_link(p_business_id uuid, p_sale_id uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT authz.has_permission(p_business_id, 'sales.view') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501'; END IF;
 UPDATE public.receipt_links SET revoked_at = now(), revoked_by = auth.uid()
  WHERE business_id = p_business_id AND sale_id = p_sale_id AND revoked_at IS NULL;
 RETURN FOUND;
END $$;

-- The receipt behind a link, for anyone holding it. Null when the link is unknown or revoked.
CREATE FUNCTION public.public_receipt(p_token text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT platform.sale_receipt(l.business_id, l.sale_id) FROM public.receipt_links l
  WHERE p_token ~ '^[0-9a-f]{64}$' AND l.token = p_token AND l.revoked_at IS NULL
$$;

-- Settings › Notifications: the reminder switches, this month's texts and the latest messages (addresses masked).
CREATE FUNCTION public.notification_overview(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501'; END IF;
 RETURN jsonb_build_object(
  'invoice_reminders', coalesce((SELECT invoice_reminders FROM public.notification_settings WHERE business_id = p_business_id), false),
  'booking_reminders', coalesce((SELECT booking_reminders FROM public.notification_settings WHERE business_id = p_business_id), false),
  'can_edit', authz.has_permission(p_business_id, 'settings.edit'),
  'booking_allowed', coalesce(platform.entitlement(p_business_id, 'module.booking_reminders') = 'true'::jsonb, true),
  'texts', platform.text_quota(p_business_id),
  'recent', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'channel', m.channel, 'to', m.shown_to, 'status', m.status,
     'created_at', m.created_at) ORDER BY m.created_at DESC, m.id DESC), '[]'::jsonb)
    FROM (SELECT * FROM platform.customer_messages WHERE business_id = p_business_id ORDER BY created_at DESC, id DESC LIMIT 30) m));
END $$;

CREATE FUNCTION public.save_notification_settings(p_business_id uuid, p_invoice_reminders boolean, p_booking_reminders boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT authz.has_permission(p_business_id, 'settings.edit') THEN RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501'; END IF;
 IF NOT platform.writes_allowed(p_business_id) THEN RAISE EXCEPTION 'PLAN_READ_ONLY' USING ERRCODE = 'P0001'; END IF;
 INSERT INTO public.notification_settings(business_id, invoice_reminders, booking_reminders, updated_by)
 VALUES (p_business_id, coalesce(p_invoice_reminders, false), coalesce(p_booking_reminders, false), auth.uid())
 ON CONFLICT (business_id) DO UPDATE SET invoice_reminders = EXCLUDED.invoice_reminders, booking_reminders = EXCLUDED.booking_reminders,
   updated_by = EXCLUDED.updated_by, updated_at = now();
 RETURN public.notification_overview(p_business_id);
END $$;

-- The operator's batch, as for billing reminders: queued, or failed or stuck for an hour, up to three attempts; stale
-- after three days. Addresses are cleared from finished messages after 30 days.
CREATE FUNCTION platform.claim_customer_messages(p_channels text[], p_limit integer DEFAULT 50, p_now timestamptz DEFAULT now()) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE claimed jsonb;
BEGIN
 UPDATE platform.customer_messages SET status = 'skipped', last_error = 'stale'
  WHERE status IN ('queued', 'failed', 'sending') AND created_at < p_now - interval '3 days';
 UPDATE platform.customer_messages SET recipient = NULL
  WHERE recipient IS NOT NULL AND status IN ('sent', 'failed', 'skipped') AND created_at < p_now - interval '30 days';
 WITH batch AS (
  SELECT m.id FROM platform.customer_messages m
   WHERE m.channel = ANY (p_channels) AND m.attempts < 3 AND m.recipient IS NOT NULL
     AND (m.status = 'queued' OR (m.status IN ('failed', 'sending') AND m.claimed_at < p_now - interval '1 hour'))
   ORDER BY m.created_at, m.id LIMIT least(greatest(p_limit, 1), 200) FOR UPDATE SKIP LOCKED
 ), marked AS (
  UPDATE platform.customer_messages m SET status = 'sending', attempts = m.attempts + 1, claimed_at = p_now
    FROM batch WHERE m.id = batch.id RETURNING m.*
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'channel', m.channel, 'to', m.recipient, 'details', m.details,
   'business', b.name, 'business_email', to_jsonb(b)->>'email', 'business_phone', to_jsonb(b)->>'phone_number') ORDER BY m.id), '[]'::jsonb)
   INTO claimed FROM marked m JOIN public.businesses b ON b.id = m.business_id;
 RETURN claimed;
END $$;

CREATE FUNCTION platform.finish_customer_message(p_id bigint, p_sent boolean, p_provider_id text, p_error text) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 UPDATE platform.customer_messages
    SET status = CASE WHEN p_sent THEN 'sent' WHEN p_error = 'no_recipient' THEN 'skipped' ELSE 'failed' END,
        sent_at = CASE WHEN p_sent THEN now() END, provider_id = left(p_provider_id, 120), last_error = left(p_error, 200)
  WHERE id = p_id AND status = 'sending';
$$;

REVOKE ALL ON FUNCTION platform.text_quota(uuid, timestamptz), platform.queue_customer_message(uuid, text, text, text, text, uuid, jsonb, uuid),
 platform.receipt_link(uuid, uuid, uuid), platform.sale_receipt(uuid, uuid), platform.claim_customer_messages(text[], integer, timestamptz),
 platform.finish_customer_message(bigint, boolean, text, text), platform.masked(text, text), platform.nigerian_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.claim_customer_messages(text[], integer, timestamptz), platform.finish_customer_message(bigint, boolean, text, text)
 TO cacu_runtime;
REVOKE ALL ON FUNCTION public.share_receipt(uuid, uuid, uuid, text, text), public.revoke_receipt_link(uuid, uuid), public.public_receipt(text),
 public.notification_overview(uuid), public.save_notification_settings(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_receipt(uuid, uuid, uuid, text, text), public.revoke_receipt_link(uuid, uuid),
 public.notification_overview(uuid), public.save_notification_settings(uuid, boolean, boolean) TO authenticated;
-- The receipt link page is public: anyone holding the link may see that one receipt.
GRANT EXECUTE ON FUNCTION public.public_receipt(text) TO anon, authenticated;
