-- Payroll remittances, part 2 (Doc 10 E21, R4): payslips employees can open.
--
-- An Owner or Admin shares one approved payslip with its employee as a link (/payslip/<token>) that opens without an
-- account. A payslip holds pay and identity numbers, so the link is guarded more tightly than a receipt link:
--   * the token is 64 hex characters and only its SHA-256 is stored, so the table never holds a working link;
--   * it expires (30 days unless the sharer chooses 1 to 90) and can be withdrawn at any time;
--   * sharing again replaces the old link, so each payslip has at most one live link;
--   * it stops working if the run is cancelled;
--   * it shows the payslip only: tax ID and pension PIN are shown by their last 4 characters, and nothing else about
--     the employee (address, phone, bank details) is included;
--   * each share, withdrawal and opening is recorded.
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.hr_payslip_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 payslip_id uuid NOT NULL REFERENCES public.hr_payslips(id),
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 revoked_by uuid,
 open_count integer NOT NULL DEFAULT 0 CHECK (open_count >= 0),
 first_opened_at timestamptz,
 last_opened_at timestamptz,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days 1 minute')
);
CREATE UNIQUE INDEX hr_payslip_links_live ON public.hr_payslip_links (business_id, payslip_id) WHERE revoked_at IS NULL;
CREATE INDEX hr_payslip_links_payslip ON public.hr_payslip_links (business_id, payslip_id, created_at DESC);
-- Only the functions below touch it: nobody reads or writes it directly, not even Owners.
ALTER TABLE public.hr_payslip_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_payslip_links FROM PUBLIC, anon, authenticated;

CREATE FUNCTION hr_private.mask(p_value text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN nullif(btrim(coalesce(p_value, '')), '') IS NULL THEN NULL
  WHEN char_length(btrim(p_value)) <= 4 THEN repeat('•', char_length(btrim(p_value)))
  ELSE '••••' || right(btrim(p_value), 4) END
$$;

-- Makes a new link for one payslip of an approved run, replacing any live one. The token is returned once, here.
CREATE FUNCTION public.hr_share_payslip(p_business_id uuid, p_payslip_id uuid, p_days integer DEFAULT 30) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; slip public.hr_payslips%ROWTYPE; run_status text; token text; link public.hr_payslip_links%ROWTYPE; replaced boolean;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'INVALID_EXPIRY' USING ERRCODE = '22023'; END IF;
 SELECT * INTO slip FROM public.hr_payslips s WHERE s.id = p_payslip_id AND s.business_id = p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYSLIP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
 SELECT r.status INTO run_status FROM public.hr_payroll_runs r WHERE r.id = slip.run_id AND r.business_id = p_business_id FOR SHARE;
 IF run_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'PAYROLL_RUN_NOT_APPROVED' USING ERRCODE = '55000'; END IF;
 UPDATE public.hr_payslip_links SET revoked_at = now(), revoked_by = actor
  WHERE business_id = p_business_id AND payslip_id = p_payslip_id AND revoked_at IS NULL;
 replaced := FOUND;
 token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
 INSERT INTO public.hr_payslip_links(business_id, payslip_id, employee_id, token_sha256, expires_at, created_by)
 VALUES (p_business_id, p_payslip_id, slip.employee_id, encode(sha256(convert_to(token, 'UTF8')), 'hex'), now() + make_interval(days => p_days), actor)
 RETURNING * INTO link;
 INSERT INTO hr_private.audit(business_id, actor_id, event, record_id, details)
 VALUES (p_business_id, actor, 'payslip.shared', slip.employee_id,
  jsonb_build_object('payslip_id', slip.id, 'run_id', slip.run_id, 'expires_at', link.expires_at, 'replaced', replaced));
 RETURN jsonb_build_object('token', token, 'payslip_id', slip.id, 'expires_at', link.expires_at);
END $f$;

-- Withdraws a payslip's live link. False when there was none.
CREATE FUNCTION public.hr_withdraw_payslip_link(p_business_id uuid, p_payslip_id uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; link public.hr_payslip_links%ROWTYPE;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 UPDATE public.hr_payslip_links SET revoked_at = now(), revoked_by = actor
  WHERE business_id = p_business_id AND payslip_id = p_payslip_id AND revoked_at IS NULL RETURNING * INTO link;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO hr_private.audit(business_id, actor_id, event, record_id, details)
 VALUES (p_business_id, actor, 'payslip.withdrawn', link.employee_id, jsonb_build_object('payslip_id', p_payslip_id));
 RETURN true;
END $f$;

-- The live links of a run, for its page: when each was shared, when it expires and whether it has been opened.
CREATE FUNCTION public.hr_payslip_links(p_business_id uuid, p_run_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; result jsonb;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], false);
 SELECT coalesce(jsonb_agg(jsonb_build_object('payslip_id', l.payslip_id, 'shared_at', l.created_at, 'expires_at', l.expires_at,
   'expired', l.expires_at <= now(), 'open_count', l.open_count, 'last_opened_at', l.last_opened_at) ORDER BY l.created_at), '[]'::jsonb)
 INTO result
 FROM public.hr_payslip_links l JOIN public.hr_payslips s ON s.id = l.payslip_id AND s.business_id = l.business_id
 WHERE l.business_id = p_business_id AND s.run_id = p_run_id AND l.revoked_at IS NULL;
 RETURN result;
END $f$;

-- Opens a payslip by its link. Null for a link that is unknown, withdrawn, expired or for a cancelled run.
CREATE FUNCTION public.public_payslip(p_token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE link public.hr_payslip_links%ROWTYPE; result jsonb;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO link FROM public.hr_payslip_links l WHERE l.token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
 IF NOT FOUND OR link.revoked_at IS NOT NULL OR link.expires_at <= now() THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
   'business', jsonb_build_object('name', b.name, 'address', to_jsonb(b)->>'address'),
   'period', r.period, 'employee', jsonb_build_object('name', s.employee_name, 'job_title', s.job_title,
     'tax_id', hr_private.mask(e.tax_id), 'pension_pin', hr_private.mask(e.pension_pin), 'pfa', d.pfa, 'tax_state', d.tax_state),
   'earnings', jsonb_build_object('basic', s.basic, 'housing', s.housing, 'transport', s.transport, 'other', s.other, 'gross', s.gross),
   'deductions', jsonb_build_object('paye', s.paye, 'pension', s.pension_employee, 'nhf', s.nhf, 'nhis', s.nhis),
   'net', s.net, 'employer_pension', s.pension_employer, 'taxable_annual', s.chargeable_annual,
   'approved_at', r.approved_at, 'expires_at', link.expires_at)
 INTO result
 FROM public.hr_payslips s
 JOIN public.hr_payroll_runs r ON r.id = s.run_id AND r.business_id = s.business_id
 JOIN public.employees e ON e.id = s.employee_id AND e.business_id = s.business_id
 JOIN public.businesses b ON b.id = s.business_id
 LEFT JOIN public.hr_remittance_details d ON d.business_id = s.business_id AND d.employee_id = s.employee_id
 WHERE s.id = link.payslip_id AND s.business_id = link.business_id AND r.status = 'approved';
 IF result IS NULL THEN RETURN NULL; END IF;
 UPDATE public.hr_payslip_links SET open_count = open_count + 1, first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now()
  WHERE id = link.id;
 RETURN result;
END $f$;

REVOKE ALL ON FUNCTION hr_private.mask(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_share_payslip(uuid, uuid, integer), public.hr_withdraw_payslip_link(uuid, uuid), public.hr_payslip_links(uuid, uuid),
 public.public_payslip(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_share_payslip(uuid, uuid, integer), public.hr_withdraw_payslip_link(uuid, uuid), public.hr_payslip_links(uuid, uuid)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_payslip(text) TO anon, authenticated;
