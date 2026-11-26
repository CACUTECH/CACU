-- Payroll remittances, part 1 (Doc 10 E21, R4): the schedules a business sends with each remittance.
--
-- PAYE goes to the State Internal Revenue Service of the state where each employee lives (Nigeria Tax Act 2025 and
-- Nigeria Tax Administration Act 2025); pension goes to each employee's Pension Fund Administrator (Pension Reform Act
-- 2014); NHF to the Federal Mortgage Bank; NHIS to the health insurer. So each employee carries two more facts: the
-- state they are taxed in and their PFA. They are kept beside the employee record, changed through one audited
-- function, so hr_write and its validated fields stay as they are.
--
-- A schedule is read from an approved run's payslips, which never change, grouped by state or PFA, and says which
-- employees are missing a state, PFA, tax ID or pension PIN. Owners and Admins only, as for the rest of HR.
-- The schedules' layout is CACU's own; each authority's upload format is to be confirmed before release (R4 gate).
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.hr_remittance_details (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 tax_state text CHECK (tax_state IS NULL OR tax_state IN ('Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
  'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara')),
 pfa text CHECK (pfa IS NULL OR char_length(pfa) BETWEEN 2 AND 80),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, employee_id)
);
ALTER TABLE public.hr_remittance_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_remittance_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hr_remittance_details TO authenticated;
CREATE POLICY hr_manager_read ON public.hr_remittance_details FOR SELECT TO authenticated
 USING (public.has_business_role(business_id, ARRAY['owner', 'admin']::public.membership_role[]));

-- Sets an employee's tax state and PFA (either may be cleared). Recorded in the HR history like any other change.
CREATE FUNCTION public.hr_save_remittance_details(p_business_id uuid, p_employee_id uuid, p_tax_state text, p_pfa text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; state text := nullif(btrim(coalesce(p_tax_state, '')), ''); fund text := nullif(regexp_replace(btrim(coalesce(p_pfa, '')), '\s+', ' ', 'g'), '');
 before public.hr_remittance_details%ROWTYPE; changed text[] := ARRAY[]::text[];
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 IF NOT EXISTS (SELECT FROM public.employees e WHERE e.id = p_employee_id AND e.business_id = p_business_id) THEN
  RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND' USING ERRCODE = 'P0002';
 END IF;
 IF fund IS NOT NULL AND char_length(fund) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'INVALID_PFA' USING ERRCODE = '22023'; END IF;
 SELECT * INTO before FROM public.hr_remittance_details WHERE business_id = p_business_id AND employee_id = p_employee_id FOR UPDATE;
 IF before.tax_state IS DISTINCT FROM state THEN changed := changed || 'tax_state'; END IF;
 IF before.pfa IS DISTINCT FROM fund THEN changed := changed || 'pfa'; END IF;
 BEGIN
  INSERT INTO public.hr_remittance_details(business_id, employee_id, tax_state, pfa, updated_by) VALUES (p_business_id, p_employee_id, state, fund, actor)
  ON CONFLICT (business_id, employee_id) DO UPDATE SET tax_state = excluded.tax_state, pfa = excluded.pfa, updated_by = excluded.updated_by, updated_at = now();
 EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'INVALID_TAX_STATE' USING ERRCODE = '22023';
 END;
 IF cardinality(changed) > 0 THEN
  INSERT INTO hr_private.audit(business_id, actor_id, event, record_id, details)
  VALUES (p_business_id, actor, 'employee.remittance', p_employee_id, jsonb_build_object('fields', to_jsonb(changed)));
 END IF;
 RETURN jsonb_build_object('tax_state', state, 'pfa', fund);
END $f$;

-- The schedules for an approved run: PAYE by state, pension by PFA, NHF and NHIS, each employee with the figures from
-- their payslip, and what is missing before the schedules can be sent.
CREATE FUNCTION public.hr_remittance_schedule(p_business_id uuid, p_run_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; run public.hr_payroll_runs%ROWTYPE; rows jsonb;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], false);
 SELECT * INTO run FROM public.hr_payroll_runs r WHERE r.id = p_run_id AND r.business_id = p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
 IF run.status <> 'approved' THEN RAISE EXCEPTION 'PAYROLL_RUN_NOT_APPROVED' USING ERRCODE = '55000'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', s.employee_id, 'name', s.employee_name, 'tax_id', e.tax_id, 'pension_pin', e.pension_pin,
   'tax_state', d.tax_state, 'pfa', d.pfa, 'gross', s.gross, 'taxable_monthly', round(s.chargeable_annual / 12, 2), 'paye', s.paye,
   'pension_employee', s.pension_employee, 'pension_employer', s.pension_employer, 'nhf', s.nhf, 'nhis', s.nhis) ORDER BY s.employee_name, s.employee_id), '[]'::jsonb)
 INTO rows
 FROM public.hr_payslips s JOIN public.employees e ON e.id = s.employee_id AND e.business_id = s.business_id
 LEFT JOIN public.hr_remittance_details d ON d.business_id = s.business_id AND d.employee_id = s.employee_id
 WHERE s.business_id = p_business_id AND s.run_id = p_run_id;
 RETURN jsonb_build_object('run', jsonb_build_object('id', run.id, 'period', run.period, 'employee_count', run.employee_count), 'payslips', rows,
  'totals', jsonb_build_object('paye', run.paye_total, 'pension', run.pension_employee_total + run.pension_employer_total, 'nhf', run.nhf_total, 'nhis', run.nhis_total));
END $f$;
REVOKE ALL ON FUNCTION public.hr_save_remittance_details(uuid, uuid, text, text), public.hr_remittance_schedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_save_remittance_details(uuid, uuid, text, text), public.hr_remittance_schedule(uuid, uuid) TO authenticated;
