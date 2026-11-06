-- Permission model, part 3 (Doc 08 §8, Doc 07 M-08): inventory approvals, ledger and reports, HR, settings and billing
-- now also require authz.has_permission. As in part 2, the old role checks stay, so both must pass during the switch.
--
-- Existing admins move to a new compatibility template, Admin (legacy): the Doc 08 Admin row plus the ledger rights
-- admins use today (reversals, period close, chart and opening balances) and paying a due renewal. The Doc 08 Admin
-- template stays as written for people assigned it on screen (part 4). The one deliberate change: choosing or changing
-- the plan, cancelling and removing the saved card are Owner-only (Doc 08 §5; billing.edit).
SET LOCAL search_path = public, pg_catalog;

-- Admin (legacy): today's admin rights.
INSERT INTO authz.role_templates(code, name, is_builtin, legacy_role)
SELECT 'admin_legacy', 'Admin (legacy)', true, NULL
 WHERE NOT EXISTS (SELECT FROM authz.role_templates WHERE code = 'admin_legacy' AND business_id IS NULL);
INSERT INTO authz.role_template_permissions(template_id, permission_code)
SELECT l.id, p.permission_code
  FROM authz.role_templates l
  JOIN authz.role_templates a ON a.code = 'admin' AND a.business_id IS NULL
  JOIN authz.role_template_permissions p ON p.template_id = a.id
 WHERE l.code = 'admin_legacy' AND l.business_id IS NULL
UNION
SELECT l.id, x.code
  FROM authz.role_templates l
 CROSS JOIN (VALUES ('ledger.create'), ('ledger.edit'), ('ledger.approve'), ('ledger.post'), ('billing.post')) x(code)
 WHERE l.code = 'admin_legacy' AND l.business_id IS NULL
ON CONFLICT DO NOTHING;
-- The admin role now maps to Admin (legacy); members already on the Admin template follow.
UPDATE authz.role_templates SET legacy_role = NULL WHERE code = 'admin' AND business_id IS NULL;
UPDATE authz.role_templates SET legacy_role = 'admin' WHERE code = 'admin_legacy' AND business_id IS NULL;
UPDATE public.memberships m SET role_template_id = l.id
  FROM authz.role_templates a, authz.role_templates l
 WHERE a.code = 'admin' AND a.business_id IS NULL AND l.code = 'admin_legacy' AND l.business_id IS NULL
   AND m.role::text = 'admin' AND m.role_template_id = a.id;

-- The decision for a named actor. Billing functions run on the runtime connection with the actor as an argument;
-- auth.uid() is not set there. Not granted to anyone: only definer functions call it.
CREATE OR REPLACE FUNCTION authz.has_permission_for(p_actor uuid, p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE perm authz.permissions%ROWTYPE; m public.memberships%ROWTYPE;
BEGIN
 SELECT * INTO perm FROM authz.permissions WHERE code = p_permission;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_PERMISSION %', p_permission USING ERRCODE = '22023'; END IF;
 IF p_actor IS NULL THEN RETURN false; END IF;
 SELECT * INTO m FROM public.memberships WHERE business_id = p_business_id AND user_id = p_actor AND is_active;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_location_id IS NOT NULL AND NOT coalesce((to_jsonb(m)->>'all_locations')::boolean, true)
    AND (to_jsonb(m)->>'location_id')::uuid IS DISTINCT FROM p_location_id THEN
  RETURN false;
 END IF;
 IF NOT authz.plan_allows(p_business_id, perm.module) THEN RETURN false; END IF;
 IF m.role::text = 'owner' THEN RETURN true; END IF;
 IF EXISTS (SELECT FROM authz.membership_overrides WHERE business_id = p_business_id AND user_id = p_actor
            AND permission_code = p_permission AND effect = 'revoke') THEN
  RETURN false;
 END IF;
 RETURN EXISTS (SELECT FROM authz.role_template_permissions WHERE template_id = m.role_template_id AND permission_code = p_permission)
     OR EXISTS (SELECT FROM authz.membership_overrides WHERE business_id = p_business_id AND user_id = p_actor
                AND permission_code = p_permission AND effect = 'grant');
END $$;

-- Same decision, for the signed-in caller.
CREATE OR REPLACE FUNCTION authz.has_permission(p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT authz.has_permission_for(auth.uid(), p_business_id, p_permission, p_location_id);
$$;

CREATE OR REPLACE FUNCTION authz.require_for(p_actor uuid, p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT authz.has_permission_for(p_actor, p_business_id, p_permission, p_location_id) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED %', p_permission USING ERRCODE = '42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION authz.has_permission_for(uuid, uuid, text, uuid), authz.require_for(uuid, uuid, text, uuid)
 FROM PUBLIC, anon, authenticated;

-- Each function gets one check right after its opening BEGIN, patched from its live definition as in part 2.
DO $patch$
DECLARE target record; fn regprocedure; def text; head text; body text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   -- HR (Doc 08: HR manager VCEAPX; Admin VCEAX, so admins keep payroll approval)
   ('public.hr_write(uuid,uuid,text,uuid,bigint,jsonb)',
    $$authz.require(p_business_id, CASE WHEN p_operation = 'employee.save' AND p_id IS NULL THEN 'hr.create'
          WHEN p_operation IN ('attendance.check_in', 'attendance.check_out', 'payroll.create') THEN 'hr.create'
          WHEN p_operation IN ('payroll.approve', 'payroll.cancel') THEN 'hr.approve'
          ELSE 'hr.edit' END)$$),
   ('public.hr_history(uuid,uuid)', $$authz.require(p_business_id, 'hr.view')$$),
   -- Settings and catalogue reads
   ('public.management_read(uuid,text,jsonb)',
    $$authz.require(p_business_id, CASE WHEN p_section IN ('catalog', 'options') THEN 'inventory.view' ELSE 'settings.view' END)$$),
   -- Ledger: chart, opening balances, dashboard figures and invoice balances
   ('public.adopt_default_chart(uuid,uuid)', $$authz.require(p_business_id, 'ledger.edit')$$),
   ('public.save_account(uuid,uuid,text,uuid,jsonb)', $$authz.require(p_business_id, 'ledger.edit')$$),
   ('public.save_opening_position(uuid,uuid,integer,jsonb)', $$authz.require(p_business_id, 'ledger.create')$$),
   ('public.approve_opening_position(uuid,integer,text)', $$authz.require(p_business_id, 'ledger.approve')$$),
   ('public.opening_position(uuid)', $$authz.require(p_business_id, 'ledger.view')$$),
   ('public.get_business_kpis(uuid,date,date)', $$authz.require(p_business_id, 'sales.view')$$),
   ('public.get_revenue_trend(uuid,date,date,text)', $$authz.require(p_business_id, 'sales.view')$$),
   ('public.legacy_invoice_balances(uuid)', $$authz.require(p_business_id, 'invoices.view')$$),
   -- Billing: reading is billing.view; choosing or changing the plan, cancelling and the saved card are billing.edit
   -- (Owner only); paying a due renewal is billing.post.
   ('public.billing_quote(uuid,text,text)', $$authz.require(p_business_id, 'billing.view')$$),
   ('public.business_billing_history(uuid)', $$authz.require(p_business_id, 'billing.view')$$),
   ('public.downgrade_choices(uuid)', $$authz.require(p_business_id, 'billing.view')$$),
   ('public.save_downgrade_choices(uuid,uuid[],uuid[])', $$authz.require(p_business_id, 'billing.edit')$$),
   ('public.remove_payment_method(uuid)', $$authz.require(p_business_id, 'billing.edit')$$),
   ('public.cancel_subscription(uuid,boolean)', $$authz.require(p_business_id, 'billing.edit')$$),
   ('platform.open_checkout(uuid,uuid,uuid,text,text)', $$authz.require_for(p_actor, p_business_id, 'billing.edit')$$),
   ('platform.schedule_plan_change(uuid,uuid,text,text)', $$authz.require_for(p_actor, p_business_id, 'billing.edit')$$),
   ('platform.renewal_checkout(uuid,uuid)', $$authz.require_for(p_actor, p_business_id, 'billing.post')$$)
  ) t(signature, check_call)
 LOOP
  fn := to_regprocedure(target.signature);
  IF fn IS NULL THEN
   RAISE NOTICE 'permission switch: % is not in this database; skipped', target.signature;
   CONTINUE;
  END IF;
  def := pg_get_functiondef(fn);
  CONTINUE WHEN def ~ 'authz\.require';  -- already switched
  IF position('$function$' IN def) = 0 THEN
   RAISE EXCEPTION 'permission switch: % does not have the expected shape', target.signature;
  END IF;
  head := substring(def FROM 1 FOR position('$function$' IN def) + length('$function$') - 1);
  body := substring(def FROM position('$function$' IN def) + length('$function$'));
  IF body !~ '\mBEGIN\M' THEN
   RAISE EXCEPTION 'permission switch: % does not have the expected shape', target.signature;
  END IF;
  EXECUTE head || regexp_replace(body, '\mBEGIN\M', 'BEGIN' || E'\n PERFORM ' || target.check_call || ';');
 END LOOP;
END
$patch$;

-- HR records read through the Data API also need hr.view (and so a plan with staff records).
DO $hr$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['employees', 'attendance', 'hr_payroll_rules', 'hr_payroll_runs', 'hr_payslips'] LOOP
  CONTINUE WHEN to_regclass('public.' || tab) IS NULL;
  EXECUTE format('DROP POLICY IF EXISTS authz_hr_view ON public.%I', tab);
  EXECUTE format('CREATE POLICY authz_hr_view ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (authz.has_permission(business_id, %L))',
                 tab, 'hr.view');
 END LOOP;
END
$hr$;
