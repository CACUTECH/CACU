-- Hosted employees store lower-case status codes (active, on_leave, exited) under
-- employees_employment_status_check. Align hr_write with those codes and allow suspended.
-- Labels are mapped in the application. Requires 20261029090000_hr_workflows.
BEGIN;
UPDATE public.employees SET employment_status=CASE employment_status
  WHEN 'Active' THEN 'active' WHEN 'On leave' THEN 'on_leave' WHEN 'Suspended' THEN 'suspended' WHEN 'Departed' THEN 'exited' END
 WHERE employment_status IN ('Active','On leave','Suspended','Departed');
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employment_status_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_employment_status_check CHECK(employment_status IN ('active','on_leave','suspended','exited'));
ALTER TABLE public.employees ALTER COLUMN employment_status SET DEFAULT 'active';

CREATE OR REPLACE FUNCTION public.hr_write(p_business_id uuid,p_request_key uuid,p_operation text,p_id uuid DEFAULT NULL,p_version bigint DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid; fingerprint text; previous hr_private.requests%ROWTYPE; e public.employees%ROWTYPE; old_e public.employees%ROWTYPE;
 a public.attendance%ROWTYPE; run public.hr_payroll_runs%ROWTYPE; saved public.hr_payroll_rules%ROWTYPE; result jsonb; ident uuid; k text;
 today date; v_period date; slip jsonb; slips jsonb:='[]'::jsonb; v_rules jsonb; reviewed timestamptz; v_excluded jsonb:='[]'::jsonb; changed text[]:='{}'; record_id uuid;
 amount_keys text[]:=ARRAY['pay_basic','pay_housing','pay_transport','pay_other','annual_rent','nhis_monthly']; v_status text;
BEGIN
 actor:=management_private.authorize(p_business_id,ARRAY['owner','admin'],true);
 IF p_request_key IS NULL OR p_operation IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(actor,p_operation,p_id,p_version,p_data)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM hr_private.requests WHERE business_id=p_business_id AND request_key=p_request_key;
 IF FOUND THEN IF previous.actor_id<>actor OR previous.payload_hash<>fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED'; END IF; RETURN previous.result||'{"replayed":true}'::jsonb; END IF;
 today:=timezone(hr_private.business_zone(p_business_id),now())::date;

 IF p_operation='employee.save' THEN
  FOR k IN SELECT jsonb_object_keys(p_data) LOOP
   IF k<>ALL(ARRAY['full_name','job_title','department','email','phone','start_date','tax_id','pension_pin','pension_enrolled','nhf_enrolled']||amount_keys) THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD: %',k; END IF;
   IF k=ANY(amount_keys) AND jsonb_typeof(p_data->k)<>'null' AND coalesce(p_data->>k,'') !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
   IF k IN ('pension_enrolled','nhf_enrolled') AND jsonb_typeof(p_data->k)<>'boolean' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE'; END IF;
   IF k IN ('pay_housing','pay_transport','pay_other','annual_rent','nhis_monthly') AND jsonb_typeof(p_data->k)='null' THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
   IF k='start_date' AND jsonb_typeof(p_data->k)<>'null' AND hr_private.safe_date(p_data->>k) IS NULL THEN RAISE EXCEPTION 'INVALID_EMPLOYEE'; END IF;
  END LOOP;
  IF p_id IS NOT NULL THEN
   SELECT * INTO old_e FROM public.employees WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
   IF p_version IS DISTINCT FROM old_e.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   e:=jsonb_populate_record(old_e,p_data);
  ELSE
   e:=jsonb_populate_record(NULL::public.employees,jsonb_build_object('pay_housing',0,'pay_transport',0,'pay_other',0,'annual_rent',0,'nhis_monthly',0,
    'pension_enrolled',true,'nhf_enrolled',false)||p_data);
   e.id:=gen_random_uuid();e.business_id:=p_business_id;e.employment_status:='active';e.version:=1;e.created_by:=actor;
  END IF;
  e.full_name:=btrim(e.full_name);e.job_title:=nullif(btrim(e.job_title),'');e.department:=nullif(btrim(e.department),'');
  e.email:=nullif(lower(btrim(e.email)),'');e.phone:=nullif(btrim(e.phone),'');e.tax_id:=nullif(btrim(e.tax_id),'');e.pension_pin:=nullif(btrim(e.pension_pin),'');
  IF e.full_name IS NULL OR length(e.full_name) NOT BETWEEN 1 AND 200 OR length(coalesce(e.job_title,''))>100 OR length(coalesce(e.department,''))>100
   OR (e.email IS NOT NULL AND (length(e.email)>254 OR e.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
   OR (e.phone IS NOT NULL AND e.phone !~ '^[0-9+() -]{5,40}$') OR length(coalesce(e.tax_id,''))>40 OR length(coalesce(e.pension_pin,''))>40
   OR (e.start_date IS NOT NULL AND e.start_date>today+366) OR (e.start_date IS NOT NULL AND e.end_date IS NOT NULL AND e.end_date<e.start_date) THEN RAISE EXCEPTION 'INVALID_EMPLOYEE'; END IF;
  IF e.nhis_monthly>e.pay_basic+e.pay_housing+e.pay_transport+e.pay_other OR (e.pay_basic IS NULL AND e.nhis_monthly>0) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF e.pay_basic IS NOT NULL THEN e.monthly_salary:=e.pay_basic+e.pay_housing+e.pay_transport+e.pay_other; END IF;
  IF p_id IS NULL THEN
   INSERT INTO public.employees(id,business_id,full_name,job_title,department,email,phone,employment_status,monthly_salary,version,start_date,
    pay_basic,pay_housing,pay_transport,pay_other,annual_rent,pension_enrolled,nhf_enrolled,nhis_monthly,tax_id,pension_pin,created_by,updated_by,created_at,updated_at)
   VALUES(e.id,p_business_id,e.full_name,e.job_title,e.department,e.email,e.phone,'active',e.monthly_salary,1,e.start_date,
    e.pay_basic,e.pay_housing,e.pay_transport,e.pay_other,e.annual_rent,e.pension_enrolled,e.nhf_enrolled,e.nhis_monthly,e.tax_id,e.pension_pin,actor,actor,now(),now()) RETURNING * INTO e;
   changed:=ARRAY(SELECT jsonb_object_keys(p_data));
  ELSE
   UPDATE public.employees SET full_name=e.full_name,job_title=e.job_title,department=e.department,email=e.email,phone=e.phone,start_date=e.start_date,
    pay_basic=e.pay_basic,pay_housing=e.pay_housing,pay_transport=e.pay_transport,pay_other=e.pay_other,annual_rent=e.annual_rent,
    pension_enrolled=e.pension_enrolled,nhf_enrolled=e.nhf_enrolled,nhis_monthly=e.nhis_monthly,tax_id=e.tax_id,pension_pin=e.pension_pin,
    monthly_salary=e.monthly_salary,version=old_e.version+1,updated_by=actor,updated_at=now() WHERE id=p_id RETURNING * INTO e;
   changed:=ARRAY(SELECT key FROM jsonb_each(to_jsonb(e)) n WHERE key NOT IN ('version','updated_by','updated_at') AND n.value IS DISTINCT FROM to_jsonb(old_e)->key);
  END IF;
  record_id:=e.id;result:=jsonb_build_object('id',e.id,'version',e.version);
 ELSIF p_operation IN ('employee.status','employee.depart') THEN
  SELECT * INTO old_e FROM public.employees WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF p_version IS DISTINCT FROM old_e.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF p_operation='employee.status' THEN
   IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>'status') THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD'; END IF;
   v_status:=p_data->>'status';
   IF v_status IS NULL OR v_status NOT IN ('active','on_leave','suspended') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
   IF v_status=old_e.employment_status THEN RAISE EXCEPTION 'STATUS_UNCHANGED'; END IF;
   IF v_status<>'active' AND EXISTS(SELECT FROM public.attendance WHERE business_id=p_business_id AND employee_id=p_id AND check_out IS NULL) THEN RAISE EXCEPTION 'OPEN_SHIFT'; END IF;
   UPDATE public.employees SET employment_status=v_status,end_date=CASE WHEN old_e.employment_status='exited' THEN NULL ELSE end_date END,
    departure_reason=CASE WHEN old_e.employment_status='exited' THEN NULL ELSE departure_reason END,
    version=old_e.version+1,updated_by=actor,updated_at=now() WHERE id=p_id RETURNING * INTO e;
   changed:=ARRAY['employment_status'];
  ELSE
   IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>ALL(ARRAY['end_date','reason'])) THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD'; END IF;
   IF old_e.employment_status='exited' THEN RAISE EXCEPTION 'ALREADY_DEPARTED'; END IF;
   IF hr_private.safe_date(p_data->>'end_date') IS NULL OR length(btrim(coalesce(p_data->>'reason',''))) NOT BETWEEN 1 AND 500
    OR (p_data->>'end_date')::date>today+366 OR (old_e.start_date IS NOT NULL AND (p_data->>'end_date')::date<old_e.start_date) THEN RAISE EXCEPTION 'INVALID_DEPARTURE'; END IF;
   IF EXISTS(SELECT FROM public.attendance WHERE business_id=p_business_id AND employee_id=p_id AND check_out IS NULL) THEN RAISE EXCEPTION 'OPEN_SHIFT'; END IF;
   UPDATE public.employees SET employment_status='exited',end_date=(p_data->>'end_date')::date,departure_reason=btrim(p_data->>'reason'),
    version=old_e.version+1,updated_by=actor,updated_at=now() WHERE id=p_id RETURNING * INTO e;
   changed:=ARRAY['employment_status','end_date','departure_reason'];
  END IF;
  record_id:=e.id;result:=jsonb_build_object('id',e.id,'version',e.version,'employment_status',e.employment_status);
 ELSIF p_operation IN ('attendance.check_in','attendance.check_out') THEN
  IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>'note') OR length(coalesce(p_data->>'note',''))>200 THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD'; END IF;
  SELECT * INTO e FROM public.employees WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.attendance WHERE business_id=p_business_id AND employee_id=p_id AND check_out IS NULL ORDER BY check_in DESC LIMIT 1 FOR UPDATE;
  IF p_operation='attendance.check_in' THEN
   IF e.employment_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'EMPLOYEE_NOT_ACTIVE'; END IF;
   IF a.id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CHECKED_IN'; END IF;
   INSERT INTO public.attendance(id,business_id,employee_id,check_in,status,work_date,recorded_by,note)
    VALUES(gen_random_uuid(),p_business_id,p_id,now(),'Present',today,actor,nullif(btrim(p_data->>'note'),'')) RETURNING * INTO a;
  ELSE
   IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_CHECKED_IN'; END IF;
   UPDATE public.attendance SET check_out=greatest(now(),check_in),closed_by=actor,
    note=coalesce(nullif(btrim(p_data->>'note'),''),note) WHERE id=a.id RETURNING * INTO a;
  END IF;
  record_id:=a.id;changed:=ARRAY[CASE WHEN p_operation='attendance.check_in' THEN 'check_in' ELSE 'check_out' END];
  result:=jsonb_build_object('id',a.id,'employee_id',p_id,'check_in',a.check_in,'check_out',a.check_out,'work_date',a.work_date);
 ELSIF p_operation='payroll.rules' THEN
  IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>'rules') OR NOT hr_private.valid_rules(p_data->'rules') THEN RAISE EXCEPTION 'INVALID_PAYROLL_RULES'; END IF;
  SELECT * INTO saved FROM public.hr_payroll_rules WHERE business_id=p_business_id FOR UPDATE;
  IF coalesce(saved.version,0) IS DISTINCT FROM coalesce(p_version,0) THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  INSERT INTO public.hr_payroll_rules(business_id,rules,version,reviewed_by,reviewed_at) VALUES(p_business_id,p_data->'rules',1,actor,now())
   ON CONFLICT(business_id) DO UPDATE SET rules=EXCLUDED.rules,version=hr_payroll_rules.version+1,reviewed_by=actor,reviewed_at=now() RETURNING * INTO saved;
  record_id:=p_business_id;changed:=ARRAY['rules'];result:=jsonb_build_object('version',saved.version,'reviewed_at',saved.reviewed_at);
 ELSIF p_operation='payroll.create' THEN
  IF EXISTS(SELECT FROM jsonb_object_keys(p_data) t(key) WHERE key<>'period') OR coalesce(p_data->>'period','') !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  v_period:=((p_data->>'period')||'-01')::date;
  IF v_period>date_trunc('month',today)::date OR v_period<'2026-01-01' THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  IF EXISTS(SELECT FROM public.hr_payroll_runs r WHERE r.business_id=p_business_id AND r.period=v_period AND r.status<>'cancelled') THEN RAISE EXCEPTION 'PAYROLL_PERIOD_EXISTS'; END IF;
  SELECT * INTO saved FROM public.hr_payroll_rules WHERE business_id=p_business_id;
  v_rules:=coalesce(saved.rules,hr_private.default_rules());reviewed:=saved.reviewed_at;
  FOR e IN SELECT * FROM public.employees x WHERE x.business_id=p_business_id AND (x.start_date IS NULL OR x.start_date<=(v_period+interval '1 month -1 day')::date)
   AND (x.employment_status IN ('active','on_leave') OR (x.employment_status='exited' AND x.end_date>=v_period)) ORDER BY x.full_name,x.id LOOP
   IF e.employment_status='exited' THEN v_excluded:=v_excluded||jsonb_build_object('id',e.id,'name',e.full_name,'reason','Departed during this period; settle final pay separately');
   ELSIF e.pay_basic IS NULL THEN v_excluded:=v_excluded||jsonb_build_object('id',e.id,'name',e.full_name,'reason','No pay structure');
   ELSE
    slip:=hr_private.compute_payslip(e,v_rules);
    IF (slip->>'net')::numeric<0 THEN v_excluded:=v_excluded||jsonb_build_object('id',e.id,'name',e.full_name,'reason','Deductions exceed pay');
    ELSE slips:=slips||jsonb_build_array(slip||jsonb_build_object('employee_id',e.id,'employee_name',e.full_name,'job_title',e.job_title)); END IF;
   END IF;
  END LOOP;
  IF jsonb_array_length(slips)=0 THEN RAISE EXCEPTION 'NO_ELIGIBLE_EMPLOYEES'; END IF;
  ident:=gen_random_uuid();
  INSERT INTO public.hr_payroll_runs(id,business_id,period,rules,rules_reviewed_at,employee_count,gross_total,paye_total,pension_employee_total,pension_employer_total,nhf_total,nhis_total,net_total,excluded,created_by)
   SELECT ident,p_business_id,v_period,v_rules,reviewed,count(*),sum((s->>'gross')::numeric),sum((s->>'paye')::numeric),sum((s->>'pension_employee')::numeric),
    sum((s->>'pension_employer')::numeric),sum((s->>'nhf')::numeric),sum((s->>'nhis')::numeric),sum((s->>'net')::numeric),v_excluded,actor
   FROM jsonb_array_elements(slips) s RETURNING * INTO run;
  INSERT INTO public.hr_payslips(business_id,run_id,employee_id,employee_name,job_title,basic,housing,transport,other,gross,pension_employee,pension_employer,nhf,nhis,rent_relief_annual,chargeable_annual,paye_annual,paye,net)
   SELECT p_business_id,ident,(s->>'employee_id')::uuid,s->>'employee_name',s->>'job_title',(s->>'basic')::numeric,(s->>'housing')::numeric,(s->>'transport')::numeric,(s->>'other')::numeric,
    (s->>'gross')::numeric,(s->>'pension_employee')::numeric,(s->>'pension_employer')::numeric,(s->>'nhf')::numeric,(s->>'nhis')::numeric,(s->>'rent_relief_annual')::numeric,
    (s->>'chargeable_annual')::numeric,(s->>'paye_annual')::numeric,(s->>'paye')::numeric,(s->>'net')::numeric FROM jsonb_array_elements(slips) s;
  record_id:=ident;changed:=ARRAY['status'];result:=jsonb_build_object('id',run.id,'version',run.version,'status',run.status,'employee_count',run.employee_count,'excluded',run.excluded);
 ELSIF p_operation IN ('payroll.approve','payroll.cancel') THEN
  IF p_data<>'{}'::jsonb THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD'; END IF;
  SELECT * INTO run FROM public.hr_payroll_runs WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND'; END IF;
  IF p_version IS DISTINCT FROM run.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF run.status<>'draft' THEN RAISE EXCEPTION 'PAYROLL_RUN_LOCKED'; END IF;
  IF p_operation='payroll.approve' THEN
   IF run.rules_reviewed_at IS NULL THEN RAISE EXCEPTION 'PAYROLL_RULES_UNREVIEWED'; END IF;
   UPDATE public.hr_payroll_runs SET status='approved',approved_by=actor,approved_at=now() WHERE id=p_id RETURNING * INTO run;
  ELSE
   UPDATE public.hr_payroll_runs SET status='cancelled',cancelled_by=actor,cancelled_at=now() WHERE id=p_id RETURNING * INTO run;
  END IF;
  record_id:=run.id;changed:=ARRAY['status'];result:=jsonb_build_object('id',run.id,'version',run.version,'status',run.status);
 ELSE RAISE EXCEPTION 'UNKNOWN_OPERATION'; END IF;
 INSERT INTO hr_private.audit(business_id,actor_id,event,record_id,details)
  VALUES(p_business_id,actor,p_operation,record_id,jsonb_build_object('request_key',p_request_key,'fields',to_jsonb(changed),
   'before',CASE WHEN old_e.id IS NOT NULL THEN to_jsonb(old_e) END,'after',CASE WHEN p_operation LIKE 'employee.%' THEN to_jsonb(e) END));
 INSERT INTO hr_private.requests VALUES(p_business_id,p_request_key,actor,fingerprint,result,now());
 RETURN result||'{"replayed":false}'::jsonb;
END;$f$;
COMMIT;
