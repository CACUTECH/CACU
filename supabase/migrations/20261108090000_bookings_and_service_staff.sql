-- Bookings, part 1 (Doc 10 services, bookings and jobs rules; Doc 07 M-13):
--  * service staff: anyone the business books by name (stylists and technicians often don't use the app), the services
--    each delivers, weekly working hours and one-off time off (breaks, days off);
--  * bookings (public.appointments, extended): a service, a staff member able to deliver it, a start time and the
--    service's duration. Never two bookings at once for the same staff member, never outside their working hours or in
--    their time off. States: confirmed -> checked_in -> completed; confirmed -> cancelled (with a reason) or no_show
--    (once the start time has passed); rescheduling changes the time, staff or service of a confirmed booking.
--    Bookings are cancelled, never deleted, and every change is kept in public.appointment_events.
-- No booking posts to the books; deposits (PR-12) and invoicing (PR-13) come in parts 2 and 3.
-- Overlaps are refused by a trigger that serialises bookings per staff member with a transaction advisory lock and
-- then checks, rather than a gist exclusion constraint, so no extension (btree_gist) is needed.
-- Times are checked in Africa/Lagos, the business time zone for every CACU business today (no daylight saving).
SET LOCAL search_path = public, pg_catalog;

-- Service staff ------------------------------------------------------------------------------------------------------
CREATE TABLE public.service_staff (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX service_staff_active_name ON public.service_staff (business_id, lower(btrim(name))) WHERE is_active;

CREATE TABLE public.service_staff_services (
 business_id uuid NOT NULL,
 staff_id uuid NOT NULL,
 service_id uuid NOT NULL,
 PRIMARY KEY (business_id, staff_id, service_id),
 FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id) ON DELETE CASCADE
);

-- Weekly hours: ISO weekday (1 Monday to 7 Sunday), local start and end. Several ranges a day leave breaks between
-- them. A staff member with no hours set can be booked at any time.
CREATE TABLE public.service_staff_hours (
 business_id uuid NOT NULL,
 staff_id uuid NOT NULL,
 weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 starts time NOT NULL,
 ends time NOT NULL,
 PRIMARY KEY (business_id, staff_id, weekday, starts),
 FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id) ON DELETE CASCADE,
 CHECK (ends > starts)
);

CREATE TABLE public.service_staff_time_off (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL,
 staff_id uuid NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
 FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id) ON DELETE CASCADE,
 CHECK (ends_at > starts_at)
);
CREATE INDEX service_staff_time_off_staff ON public.service_staff_time_off (business_id, staff_id, starts_at);

-- A staff member delivers only the business's own active services.
CREATE FUNCTION public.service_staff_services_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.catalog_items WHERE business_id = NEW.business_id AND id = NEW.service_id AND item_type = 'SERVICE') THEN
  RAISE EXCEPTION 'SERVICE_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.service_staff_services_check() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER service_staff_services_check BEFORE INSERT OR UPDATE ON public.service_staff_services
 FOR EACH ROW EXECUTE FUNCTION public.service_staff_services_check();

CREATE FUNCTION public.service_staff_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'STAFF_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.service_staff_touch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER service_staff_touch BEFORE UPDATE ON public.service_staff FOR EACH ROW EXECUTE FUNCTION public.service_staff_touch();

-- Bookings -----------------------------------------------------------------------------------------------------------
ALTER TABLE public.appointments
 ADD COLUMN IF NOT EXISTS staff_id uuid,
 ADD COLUMN IF NOT EXISTS service_id uuid,
 ADD COLUMN IF NOT EXISTS duration_minutes integer CHECK (duration_minutes BETWEEN 5 AND 720),
 ADD COLUMN IF NOT EXISTS ends_at timestamptz,
 ADD COLUMN IF NOT EXISTS customer_name text CHECK (length(customer_name) <= 100),
 ADD COLUMN IF NOT EXISTS customer_phone text CHECK (length(customer_phone) <= 30),
 ADD COLUMN IF NOT EXISTS created_by uuid,
 ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
 ADD COLUMN IF NOT EXISTS completed_at timestamptz,
 ADD COLUMN IF NOT EXISTS cancel_reason text CHECK (length(cancel_reason) <= 500);
-- Legacy bookings were kept only in the browser; none are stored. Any old status reads as confirmed.
UPDATE public.appointments SET status = 'confirmed' WHERE status NOT IN ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');
ALTER TABLE public.appointments ALTER COLUMN status SET DEFAULT 'confirmed';
-- The legacy check allowed 'scheduled' but not 'checked_in'; the new one replaces it.
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_valid
 CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'));
-- New bookings name a staff member and a service; NOT VALID leaves any legacy row alone.
ALTER TABLE public.appointments ADD CONSTRAINT appointments_staff_and_service
 CHECK (staff_id IS NOT NULL AND service_id IS NOT NULL AND ends_at IS NOT NULL) NOT VALID;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_staff_fk
 FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id);
CREATE INDEX IF NOT EXISTS appointments_staff_time ON public.appointments (business_id, staff_id, scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_day ON public.appointments (business_id, scheduled_at);

CREATE TABLE public.appointment_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL,
 appointment_id uuid NOT NULL,
 at timestamptz NOT NULL DEFAULT now(),
 actor uuid,
 from_status text, to_status text NOT NULL,
 from_start timestamptz, to_start timestamptz NOT NULL,
 from_staff uuid, to_staff uuid,
 note text
);
CREATE INDEX appointment_events_booking ON public.appointment_events (business_id, appointment_id, at);

-- The booking rules. SECURITY DEFINER so the checks see every booking, staff member and service of the business
-- whatever the caller may read; it only reads rows of NEW's own business and decides nothing about access, which row
-- security on appointments still does.
CREATE FUNCTION public.appointments_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
 actor uuid := auth.uid(); svc record; timing boolean; local_start timestamp; local_end timestamp;
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF actor IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE = '42501'; END IF;
  NEW.created_by := actor; NEW.created_at := now(); NEW.status := 'confirmed';
  NEW.checked_in_at := NULL; NEW.completed_at := NULL; NEW.cancel_reason := NULL;
  IF NEW.customer_id IS NULL AND length(btrim(coalesce(NEW.customer_name, ''))) = 0 THEN
   RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '23514';
  END IF;
  timing := true;
 ELSE
  IF (NEW.business_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.business_id, OLD.created_by, OLD.created_at) THEN
   RAISE EXCEPTION 'BOOKING_RECORD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  timing := (NEW.scheduled_at, NEW.staff_id, NEW.service_id) IS DISTINCT FROM (OLD.scheduled_at, OLD.staff_id, OLD.service_id);
  IF timing AND NOT (OLD.status = 'confirmed' AND NEW.status = 'confirmed') THEN
   RAISE EXCEPTION 'BOOKING_NOT_RESCHEDULABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (OLD.status, NEW.status) NOT IN (('confirmed', 'checked_in'), ('confirmed', 'cancelled'), ('confirmed', 'no_show'), ('checked_in', 'completed')) THEN
    RAISE EXCEPTION 'BOOKING_STATE_INVALID' USING ERRCODE = '23514';
   END IF;
   NEW.checked_in_at := CASE WHEN NEW.status = 'checked_in' THEN now() ELSE OLD.checked_in_at END;
   NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN now() ELSE OLD.completed_at END;
   IF NEW.status = 'cancelled' THEN
    NEW.cancel_reason := btrim(coalesce(NEW.cancel_reason, ''));
    IF length(NEW.cancel_reason) < 3 THEN RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = '23514'; END IF;
   ELSE
    NEW.cancel_reason := OLD.cancel_reason;
   END IF;
   IF NEW.status = 'no_show' AND now() < OLD.scheduled_at THEN RAISE EXCEPTION 'NO_SHOW_TOO_EARLY' USING ERRCODE = '23514'; END IF;
  ELSE
   NEW.checked_in_at := OLD.checked_in_at; NEW.completed_at := OLD.completed_at; NEW.cancel_reason := OLD.cancel_reason;
  END IF;
 END IF;
 NEW.updated_at := now();
 IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.customers WHERE business_id = NEW.business_id AND id = NEW.customer_id) THEN
  RAISE EXCEPTION 'CUSTOMER_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 IF NOT timing THEN
  NEW.duration_minutes := OLD.duration_minutes; NEW.ends_at := OLD.ends_at; NEW.title := OLD.title;
  RETURN NEW;
 END IF;

 SELECT name, (to_jsonb(c) ->> 'duration')::integer AS duration INTO svc FROM public.catalog_items c
  WHERE c.business_id = NEW.business_id AND c.id = NEW.service_id AND c.item_type = 'SERVICE' AND c.is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_UNAVAILABLE' USING ERRCODE = '23514'; END IF;
 IF NOT EXISTS (SELECT FROM public.service_staff s JOIN public.service_staff_services x
                  ON x.business_id = s.business_id AND x.staff_id = s.id AND x.service_id = NEW.service_id
                 WHERE s.business_id = NEW.business_id AND s.id = NEW.staff_id AND s.is_active) THEN
  RAISE EXCEPTION 'STAFF_CANNOT_DELIVER' USING ERRCODE = '23514';
 END IF;
 -- The service's duration, an hour when the service has none.
 NEW.duration_minutes := least(greatest(coalesce(nullif(svc.duration, 0), 60), 5), 720);
 NEW.ends_at := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);
 NEW.title := svc.name;
 IF (TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) AND NEW.scheduled_at < now() - interval '5 minutes' THEN
  RAISE EXCEPTION 'BOOKING_IN_PAST' USING ERRCODE = '23514';
 END IF;

 -- One booking decision at a time per staff member, so two tills cannot take the same slot.
 PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || NEW.business_id::text || ':' || NEW.staff_id::text, 0));
 local_start := NEW.scheduled_at AT TIME ZONE 'Africa/Lagos';
 local_end := NEW.ends_at AT TIME ZONE 'Africa/Lagos';
 IF EXISTS (SELECT FROM public.service_staff_hours WHERE business_id = NEW.business_id AND staff_id = NEW.staff_id)
    AND NOT EXISTS (SELECT FROM public.service_staff_hours h
                     WHERE h.business_id = NEW.business_id AND h.staff_id = NEW.staff_id
                       AND h.weekday = extract(isodow FROM local_start) AND local_end::date = local_start::date
                       AND h.starts <= local_start::time AND h.ends >= local_end::time) THEN
  RAISE EXCEPTION 'OUTSIDE_WORKING_HOURS' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (SELECT FROM public.service_staff_time_off t
             WHERE t.business_id = NEW.business_id AND t.staff_id = NEW.staff_id
               AND tstzrange(t.starts_at, t.ends_at) && tstzrange(NEW.scheduled_at, NEW.ends_at)) THEN
  RAISE EXCEPTION 'STAFF_TIME_OFF' USING ERRCODE = '23514';
 END IF;
 IF EXISTS (SELECT FROM public.appointments a
             WHERE a.business_id = NEW.business_id AND a.staff_id = NEW.staff_id AND a.id <> NEW.id
               AND a.status IN ('confirmed', 'checked_in', 'completed')
               AND tstzrange(a.scheduled_at, a.ends_at) && tstzrange(NEW.scheduled_at, NEW.ends_at)) THEN
  RAISE EXCEPTION 'BOOKING_OVERLAP' USING ERRCODE = '23P01';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.appointments_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER appointments_rules BEFORE INSERT OR UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION public.appointments_rules();

CREATE FUNCTION public.appointments_history() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND (NEW.status, NEW.scheduled_at, NEW.staff_id) IS NOT DISTINCT FROM (OLD.status, OLD.scheduled_at, OLD.staff_id) THEN
  RETURN NULL;
 END IF;
 INSERT INTO public.appointment_events(business_id, appointment_id, actor, from_status, to_status, from_start, to_start, from_staff, to_staff, note)
 VALUES (NEW.business_id, NEW.id, auth.uid(),
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.scheduled_at END, NEW.scheduled_at,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.staff_id END, NEW.staff_id,
         CASE WHEN NEW.status = 'cancelled' THEN NEW.cancel_reason END);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.appointments_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER appointments_history AFTER INSERT OR UPDATE ON public.appointments
 FOR EACH ROW EXECUTE FUNCTION public.appointments_history();

-- Access (Doc 08): people who see services see bookings and staff; services.create books; services.edit changes a
-- booking; the staff list, hours and time off are business settings (settings.edit). Bookings are never deleted.
DO $$ DECLARE pol record; BEGIN
 FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'appointments' LOOP
  EXECUTE format('DROP POLICY %I ON public.appointments', pol.policyname);
 END LOOP;
END $$;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_read ON public.appointments FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'services.view'));
CREATE POLICY appointments_book ON public.appointments FOR INSERT TO authenticated WITH CHECK (authz.has_permission(business_id, 'services.create'));
CREATE POLICY appointments_change ON public.appointments FOR UPDATE TO authenticated
 USING (authz.has_permission(business_id, 'services.edit')) WITH CHECK (authz.has_permission(business_id, 'services.edit'));
REVOKE ALL ON public.appointments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.appointments TO authenticated;

ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_events_read ON public.appointment_events FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'services.view'));
REVOKE ALL ON public.appointment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.appointment_events TO authenticated;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['service_staff', 'service_staff_services', 'service_staff_hours', 'service_staff_time_off'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'services.view'))$p$, tab || '_read', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (authz.has_permission(business_id, 'settings.edit'))$p$, tab || '_add', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (authz.has_permission(business_id, 'settings.edit')) WITH CHECK (authz.has_permission(business_id, 'settings.edit'))$p$, tab || '_change', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (authz.has_permission(business_id, 'settings.edit'))$p$, tab || '_remove', tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $$;
-- Staff are deactivated, never deleted, so their bookings keep their name.
GRANT SELECT, INSERT, UPDATE ON public.service_staff TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.service_staff_services, public.service_staff_hours TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_staff_time_off TO authenticated;

-- Read-only while the subscription is suspended (Doc 14 SUB-10), like the other trading records.
CREATE TRIGGER service_staff_read_only_when_suspended BEFORE INSERT OR UPDATE ON public.service_staff
 FOR EACH ROW EXECUTE FUNCTION platform.read_only_guard();
