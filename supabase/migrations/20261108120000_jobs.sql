-- Jobs (Doc 10 services, bookings and jobs rules; Doc 07 M-13), bookings part 4.
--  * a job (JOB-0001, ...) for a customer or a walk-in, optionally assigned to a staff member, with service and material
--    lines from the catalogue and labour time per staff member. States: open -> in_progress -> completed; open or
--    in_progress -> cancelled (with a reason). Lines and labour change only before completion;
--  * completing a job (only through the accounting API) issues its materials from stock at cost (debit cost of sales,
--    credit inventory) and records that cost on the job;
--  * a completed job is billed once, at the till or by invoice, at catalogue prices; its materials are not issued again;
--  * job profit (Chairman, module.job_costing): revenue less materials at cost less labour at each staff member's cost
--    rate, which the owner sets (not linked to payroll until R4).
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.jobs
 ADD COLUMN IF NOT EXISTS number text,
 ADD COLUMN IF NOT EXISTS customer_name text CHECK (length(customer_name) <= 100),
 ADD COLUMN IF NOT EXISTS staff_id uuid,
 ADD COLUMN IF NOT EXISTS created_by uuid,
 ADD COLUMN IF NOT EXISTS started_at timestamptz,
 ADD COLUMN IF NOT EXISTS completed_at timestamptz,
 ADD COLUMN IF NOT EXISTS cancel_reason text CHECK (length(cancel_reason) <= 500),
 ADD COLUMN IF NOT EXISTS materials_cost numeric(15,2) CHECK (materials_cost >= 0),
 ADD COLUMN IF NOT EXISTS bill_kind text CHECK (bill_kind IN ('sale', 'invoice')),
 ADD COLUMN IF NOT EXISTS bill_id uuid,
 ADD COLUMN IF NOT EXISTS billed_at timestamptz;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_business_key UNIQUE (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_number ON public.jobs (business_id, number);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_staff_fk FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_billed_together
 CHECK ((bill_kind IS NULL) = (bill_id IS NULL) AND (bill_kind IS NULL) = (billed_at IS NULL));
ALTER TABLE public.jobs ADD CONSTRAINT jobs_billed_when_completed CHECK (bill_kind IS NULL OR status = 'completed');
ALTER TABLE public.jobs ADD CONSTRAINT jobs_completed_costed CHECK ((status = 'completed') = (completed_at IS NOT NULL AND materials_cost IS NOT NULL)) NOT VALID;
CREATE INDEX IF NOT EXISTS jobs_open ON public.jobs (business_id, status, created_at);

CREATE TABLE public.job_lines (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 catalog_item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (business_id, job_id, catalog_item_id),
 FOREIGN KEY (business_id, job_id) REFERENCES public.jobs(business_id, id)
);

CREATE TABLE public.job_labour (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 staff_id uuid NOT NULL,
 minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 10080),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (business_id, job_id) REFERENCES public.jobs(business_id, id),
 FOREIGN KEY (business_id, staff_id) REFERENCES public.service_staff(business_id, id)
);
CREATE INDEX job_labour_job ON public.job_labour (business_id, job_id);

-- The job rules. SECURITY DEFINER so the checks see the business's staff, customers and catalogue whatever the caller
-- may read; they read only rows of NEW's own business and decide nothing about access, which row security does.
CREATE FUNCTION public.jobs_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := auth.uid(); runtime boolean := session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime'; next_no integer;
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF actor IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('job-number:' || NEW.business_id::text, 0));
  SELECT coalesce(max(substring(number FROM 5)::integer), 0) + 1 INTO next_no FROM public.jobs
   WHERE business_id = NEW.business_id AND number ~ '^JOB-[0-9]+$';
  NEW.number := 'JOB-' || lpad(next_no::text, 4, '0');
  NEW.created_by := actor; NEW.created_at := now(); NEW.status := 'open';
  NEW.started_at := NULL; NEW.completed_at := NULL; NEW.cancel_reason := NULL; NEW.materials_cost := NULL;
  NEW.bill_kind := NULL; NEW.bill_id := NULL; NEW.billed_at := NULL;
  IF NEW.customer_id IS NULL AND length(btrim(coalesce(NEW.customer_name, ''))) = 0 THEN
   RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '23514';
  END IF;
 ELSE
  IF (NEW.business_id, NEW.number, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.business_id, OLD.number, OLD.created_by, OLD.created_at) THEN
   RAISE EXCEPTION 'JOB_RECORD_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  -- Completion and billing move stock and money: only the accounting API sets them.
  IF NOT runtime AND ((NEW.status = 'completed' AND OLD.status <> 'completed')
      OR (NEW.materials_cost, NEW.completed_at, NEW.bill_kind, NEW.bill_id, NEW.billed_at)
         IS DISTINCT FROM (OLD.materials_cost, OLD.completed_at, OLD.bill_kind, OLD.bill_id, OLD.billed_at)) THEN
   RAISE EXCEPTION 'JOB_COMPLETED_BY_API' USING ERRCODE = '23514';
  END IF;
  IF OLD.bill_kind IS NOT NULL AND (NEW.bill_kind, NEW.bill_id) IS DISTINCT FROM (OLD.bill_kind, OLD.bill_id) THEN
   RAISE EXCEPTION 'JOB_BILLED_ONCE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF (OLD.status, NEW.status) NOT IN (('open', 'in_progress'), ('open', 'cancelled'), ('in_progress', 'cancelled'),
                                       ('open', 'completed'), ('in_progress', 'completed')) THEN
    RAISE EXCEPTION 'JOB_STATE_INVALID' USING ERRCODE = '23514';
   END IF;
   IF NEW.status = 'in_progress' THEN NEW.started_at := now(); END IF;
   IF NEW.status = 'cancelled' THEN
    NEW.cancel_reason := btrim(coalesce(NEW.cancel_reason, ''));
    IF length(NEW.cancel_reason) < 3 THEN RAISE EXCEPTION 'CANCEL_REASON_REQUIRED' USING ERRCODE = '23514'; END IF;
   END IF;
  ELSIF OLD.status IN ('completed', 'cancelled')
        AND (NEW.title, NEW.description, NEW.due_date, NEW.customer_id, NEW.customer_name, NEW.staff_id)
            IS DISTINCT FROM (OLD.title, OLD.description, OLD.due_date, OLD.customer_id, OLD.customer_name, OLD.staff_id) THEN
   RAISE EXCEPTION 'JOB_CLOSED' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'cancelled' THEN NEW.cancel_reason := OLD.cancel_reason; END IF;
  IF NEW.status = OLD.status THEN NEW.started_at := OLD.started_at; END IF;
 END IF;
 NEW.updated_at := now();
 IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.customers WHERE business_id = NEW.business_id AND id = NEW.customer_id) THEN
  RAISE EXCEPTION 'CUSTOMER_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 IF NEW.staff_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.staff_id IS DISTINCT FROM OLD.staff_id)
    AND NOT EXISTS (SELECT FROM public.service_staff WHERE business_id = NEW.business_id AND id = NEW.staff_id AND is_active) THEN
  RAISE EXCEPTION 'STAFF_UNAVAILABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jobs_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER jobs_rules BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_rules();

-- Lines and labour change only while the job is open or in progress; lines are the business's own priced catalogue items.
CREATE FUNCTION public.job_parts_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
 IF TG_OP = 'UPDATE' AND (NEW.business_id, NEW.job_id) IS DISTINCT FROM (OLD.business_id, OLD.job_id) THEN
  RAISE EXCEPTION 'JOB_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 IF NOT EXISTS (SELECT FROM public.jobs WHERE business_id = r.business_id AND id = r.job_id AND status IN ('open', 'in_progress')) THEN
  RAISE EXCEPTION 'JOB_CLOSED' USING ERRCODE = '23514';
 END IF;
 -- Nested, not AND-ed: PL/pgSQL does not short-circuit, and each table has only its own columns.
 IF TG_OP <> 'DELETE' THEN
  IF TG_TABLE_NAME = 'job_lines' THEN
   IF NOT EXISTS (SELECT FROM public.catalog_items WHERE business_id = NEW.business_id AND id = (to_jsonb(NEW) ->> 'catalog_item_id')::uuid
                  AND is_active AND item_type IN ('SERVICE', 'PRODUCT') AND unit_price > 0) THEN
    RAISE EXCEPTION 'ITEM_UNAVAILABLE' USING ERRCODE = '23514';
   END IF;
  ELSIF NOT EXISTS (SELECT FROM public.service_staff WHERE business_id = NEW.business_id AND id = (to_jsonb(NEW) ->> 'staff_id')::uuid AND is_active) THEN
   RAISE EXCEPTION 'STAFF_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.job_parts_rules() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER job_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON public.job_lines FOR EACH ROW EXECUTE FUNCTION public.job_parts_rules();
CREATE TRIGGER job_labour_rules BEFORE INSERT OR UPDATE OR DELETE ON public.job_labour FOR EACH ROW EXECUTE FUNCTION public.job_parts_rules();

-- Access (Doc 08): services.view reads; services.create opens a job and adds to it; services.edit changes it. Jobs are
-- cancelled, never deleted.
DO $$ DECLARE pol record; BEGIN
 FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'jobs' LOOP
  EXECUTE format('DROP POLICY %I ON public.jobs', pol.policyname);
 END LOOP;
END $$;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'services.view'));
CREATE POLICY jobs_open ON public.jobs FOR INSERT TO authenticated WITH CHECK (authz.has_permission(business_id, 'services.create'));
CREATE POLICY jobs_change ON public.jobs FOR UPDATE TO authenticated
 USING (authz.has_permission(business_id, 'services.edit')) WITH CHECK (authz.has_permission(business_id, 'services.edit'));
CREATE POLICY jobs_runtime_read ON public.jobs FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));
CREATE POLICY jobs_runtime_change ON public.jobs FOR UPDATE TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON public.jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT SELECT, UPDATE ON public.jobs TO cacu_runtime;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['job_lines', 'job_labour'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (authz.has_permission(business_id, 'services.view'))$p$, tab || '_read', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (authz.has_permission(business_id, 'services.create'))$p$, tab || '_add', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (authz.has_permission(business_id, 'services.edit')) WITH CHECK (authz.has_permission(business_id, 'services.edit'))$p$, tab || '_change', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (authz.has_permission(business_id, 'services.edit'))$p$, tab || '_remove', tab);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id))$p$, tab || '_runtime_read', tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tab);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tab);
  EXECUTE format('GRANT SELECT ON public.%I TO cacu_runtime', tab);
 END LOOP;
END $$;
GRANT SELECT ON public.service_staff TO cacu_runtime;
CREATE POLICY service_staff_runtime_read ON public.service_staff FOR SELECT TO cacu_runtime USING (accounting.authorized(business_id));

CREATE TRIGGER job_lines_read_only_when_suspended BEFORE INSERT ON public.job_lines FOR EACH ROW EXECUTE FUNCTION platform.read_only_guard();

-- What a till sale billed, for the receipt and refunds.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS job_id uuid;

-- Staff cost rates for job profit, set by the owner; kept out of the Data API with the other pay figures.
CREATE TABLE accounting.staff_cost_rate (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 staff_id uuid NOT NULL,
 hourly numeric(15,2) NOT NULL CHECK (hourly >= 0),
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, staff_id)
);
ALTER TABLE accounting.staff_cost_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.staff_cost_rate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.staff_cost_rate TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT, UPDATE ON accounting.staff_cost_rate TO cacu_runtime;

-- Whether the plan includes job profit (Chairman), for the accounting runtime. Unbilled businesses keep every feature.
CREATE FUNCTION accounting.job_costing_allowed(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT accounting.authorized(p_business_id)
    AND coalesce(platform.entitlement(p_business_id, 'module.job_costing') = 'true'::jsonb, true);
$$;
REVOKE ALL ON FUNCTION accounting.job_costing_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.job_costing_allowed(uuid) TO cacu_runtime;
