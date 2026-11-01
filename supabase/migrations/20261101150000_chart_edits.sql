-- Chart of accounts edits (FR-131, Doc 09 section 4): Owners and Admins add, rename, archive and restore accounts.
--
-- Accounts with a system purpose from the template cannot be archived; automatic postings depend on them. An
-- account with a balance in the books cannot be archived either. Added accounts carry their own classification,
-- because the template only classifies its own codes. Once the books are live an added account also needs a
-- ledger account, which only the accounting API can create: it calls save_account and then map_custom_account.
SET LOCAL search_path = accounting, public, pg_catalog;

-- The kinds of account an owner can add, in plain language, with how each is classified and numbered.
CREATE TABLE onboarding_private.account_kinds (
 kind text PRIMARY KEY,
 account_type text NOT NULL, library_type text NOT NULL, flow_section text NOT NULL, purpose text,
 band_start integer NOT NULL, band_end integer NOT NULL, step integer NOT NULL
);
INSERT INTO onboarding_private.account_kinds VALUES
 ('bank', 'asset', 'BANK', 'cash', 'bank', 1000, 1099, 1),
 ('current_asset', 'asset', 'CURRENT_ASSET', 'operating', NULL, 1300, 1499, 10),
 ('fixed_asset', 'asset', 'NON_CURRENT_ASSET', 'investing', NULL, 1500, 1999, 10),
 ('current_liability', 'liability', 'CURRENT_LIABILITY', 'operating', NULL, 2100, 2499, 10),
 ('loan', 'liability', 'NON_CURRENT_LIABILITY', 'financing', NULL, 2500, 2999, 10),
 ('equity', 'equity', 'EQUITY', 'financing', NULL, 3300, 3899, 10),
 ('income', 'revenue', 'OPERATING_REVENUE', 'operating', NULL, 4200, 4899, 10),
 ('other_income', 'revenue', 'NON_OPERATING_REVENUE', 'operating', NULL, 4900, 4999, 10),
 ('expense', 'expense', 'OPERATING_EXPENSE', 'operating', NULL, 6000, 6999, 10),
 ('other_expense', 'expense', 'OTHER_EXPENSE', 'operating', NULL, 7000, 7999, 10);

CREATE TABLE onboarding_private.custom_accounts (
 account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 kind text NOT NULL REFERENCES onboarding_private.account_kinds(kind),
 request_key uuid NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (business_id, request_key)
);
ALTER TABLE onboarding_private.account_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.custom_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.account_kinds FORCE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.custom_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_private.account_kinds, onboarding_private.custom_accounts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION onboarding_private.account_json(a public.accounts) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'account_type', a.account_type, 'is_active', a.is_active,
  'kind', k.kind, 'library_type', k.library_type, 'flow_section', k.flow_section, 'purpose', k.purpose)
 FROM (SELECT 1) one
 LEFT JOIN onboarding_private.custom_accounts c ON c.account_id = a.id
 LEFT JOIN onboarding_private.account_kinds k ON k.kind = c.kind;
$$;
REVOKE ALL ON FUNCTION onboarding_private.account_json(public.accounts) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_account(p_business_id uuid, p_request_key uuid, p_operation text, p_account_id uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; native boolean := session_user = 'cacu_runtime' OR current_setting('role', true) = 'cacu_runtime';
 adoption onboarding_private.chart_adoptions%ROWTYPE; k onboarding_private.account_kinds%ROWTYPE; acc public.accounts%ROWTYPE;
 v_name text := btrim(coalesce(p_data->>'name', '')); v_code integer; v_library integer; v_purpose text; v_balance numeric;
BEGIN
 IF p_business_id IS NULL OR p_request_key IS NULL OR p_operation IS NULL OR p_operation NOT IN ('add', 'rename', 'archive', 'restore')
  OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 SELECT * INTO adoption FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHART_NOT_ADOPTED' USING ERRCODE = '23514'; END IF;

 IF p_operation = 'add' THEN
  SELECT a.* INTO acc FROM onboarding_private.custom_accounts c JOIN public.accounts a ON a.id = c.account_id
   WHERE c.business_id = p_business_id AND c.request_key = p_request_key;
  IF FOUND THEN RETURN onboarding_private.account_json(acc) || '{"replayed": true}'::jsonb; END IF;
  -- Live books need the ledger account too, which only the accounting API creates.
  IF accounting.active(p_business_id) AND NOT native THEN RAISE EXCEPTION 'USE_ACCOUNTING_API' USING ERRCODE = '23514'; END IF;
  SELECT * INTO k FROM onboarding_private.account_kinds WHERE kind = p_data->>'kind';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ACCOUNT_KIND' USING ERRCODE = '22023'; END IF;
  IF length(v_name) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT FROM public.accounts WHERE business_id = p_business_id AND lower(name) = lower(v_name)) THEN
   RAISE EXCEPTION 'DUPLICATE_ACCOUNT_NAME' USING ERRCODE = '23505'; END IF;
  SELECT coalesce(max(code::integer) + k.step, k.band_start) INTO v_code FROM public.accounts
   WHERE business_id = p_business_id AND code ~ '^[0-9]{4}$' AND code::integer BETWEEN k.band_start AND k.band_end;
  IF v_code > k.band_end THEN RAISE EXCEPTION 'CODE_RANGE_FULL' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.accounts(business_id, code, name, account_type) VALUES (p_business_id, v_code::text, v_name, k.account_type) RETURNING * INTO acc;
  INSERT INTO onboarding_private.custom_accounts(account_id, business_id, kind, request_key, created_by) VALUES (acc.id, p_business_id, k.kind, p_request_key, actor);
  INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
   VALUES (p_business_id, actor, 'ACCOUNT_ADDED', 'accounts', acc.id, jsonb_build_object('code', acc.code, 'name', acc.name, 'kind', k.kind, 'request_key', p_request_key));
  RETURN onboarding_private.account_json(acc) || '{"replayed": false}'::jsonb;
 END IF;

 SELECT * INTO acc FROM public.accounts WHERE id = p_account_id AND business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE = '22023'; END IF;
 SELECT library_id INTO v_library FROM accounting.account_map WHERE business_id = p_business_id AND account_id = acc.id;

 IF p_operation = 'rename' THEN
  IF length(v_name) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT FROM public.accounts WHERE business_id = p_business_id AND id <> acc.id AND lower(name) = lower(v_name)) THEN
   RAISE EXCEPTION 'DUPLICATE_ACCOUNT_NAME' USING ERRCODE = '23505'; END IF;
  UPDATE public.accounts SET name = v_name, updated_at = now() WHERE id = acc.id;
  -- Reports read names from the ledger account, so it is renamed with the chart.
  IF v_library IS NOT NULL THEN UPDATE accounting.account SET name = v_name WHERE id = v_library AND business_id = p_business_id; END IF;
 ELSIF p_operation = 'archive' THEN
  SELECT t.purpose INTO v_purpose FROM onboarding_private.chart_template_accounts t
   WHERE t.version = adoption.version AND t.mode = adoption.mode AND t.code = acc.code
   AND NOT EXISTS (SELECT FROM onboarding_private.custom_accounts c WHERE c.account_id = acc.id);
  IF v_purpose IS NOT NULL THEN RAISE EXCEPTION 'SYSTEM_ACCOUNT' USING ERRCODE = '23514'; END IF;
  IF v_library IS NOT NULL THEN
   SELECT coalesce(sum(CASE WHEN entry_type::text = 'DEBIT' THEN amount ELSE -amount END), 0) INTO v_balance
    FROM accounting.ledger WHERE business_id = p_business_id AND post_account_id = v_library;
   IF v_balance <> 0 THEN RAISE EXCEPTION 'ACCOUNT_HAS_BALANCE' USING ERRCODE = '23514'; END IF;
  END IF;
  UPDATE public.accounts SET is_active = false, updated_at = now() WHERE id = acc.id;
 ELSE
  UPDATE public.accounts SET is_active = true, updated_at = now() WHERE id = acc.id;
 END IF;
 SELECT * INTO acc FROM public.accounts WHERE id = acc.id;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'ACCOUNT_' || upper(p_operation) || 'D', 'accounts', acc.id,
   jsonb_build_object('code', acc.code, 'name', acc.name, 'request_key', p_request_key));
 RETURN onboarding_private.account_json(acc) || '{"replayed": false}'::jsonb;
END;$f$;
REVOKE ALL ON FUNCTION public.save_account(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_account(uuid, uuid, text, uuid, jsonb) TO authenticated, cacu_runtime;

-- Links an added account to the ledger account the accounting API just created for it, after checking the
-- ledger account is this business's, unmapped and of the added account's type.
CREATE FUNCTION accounting.map_custom_account(tenant uuid, source uuid, library integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, accounting, pg_temp AS $$
DECLARE k onboarding_private.account_kinds%ROWTYPE;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id', true), '')::uuid THEN
  RAISE EXCEPTION 'Invalid account scope' USING ERRCODE = '42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id = tenant
  AND user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
  AND is_active AND role::text IN ('owner', 'admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner or Admin required' USING ERRCODE = '42501'; END IF;
 SELECT k2.* INTO k FROM onboarding_private.custom_accounts c JOIN onboarding_private.account_kinds k2 ON k2.kind = c.kind
  JOIN public.accounts a ON a.id = c.account_id AND a.business_id = c.business_id
  WHERE c.business_id = tenant AND c.account_id = source AND a.is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADDED_ACCOUNT_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT FROM accounting.account_map WHERE business_id = tenant AND (account_id = source OR library_id = library)) THEN
  RAISE EXCEPTION 'ACCOUNT_ALREADY_MAPPED' USING ERRCODE = '23505'; END IF;
 PERFORM 1 FROM accounting.account n JOIN accounting.business_map b ON b.business_id = n.business_id AND b.entity_id = n.entity_id
  WHERE n.id = library AND n.business_id = tenant AND b.state = 'active' AND n.account_type::text = k.library_type;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ACCOUNT_MISMATCH' USING ERRCODE = '22023'; END IF;
 INSERT INTO accounting.account_map(business_id, account_id, library_id, flow_section, purpose)
  VALUES (tenant, source, library, k.flow_section, coalesce(k.purpose, 'other'));
END $$;
REVOKE ALL ON FUNCTION accounting.map_custom_account(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.map_custom_account(uuid, uuid, integer) TO cacu_runtime;

-- The chart read includes added accounts' classification and which accounts are system accounts.
CREATE OR REPLACE FUNCTION public.chart_of_accounts(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE adoption onboarding_private.chart_adoptions%ROWTYPE; template onboarding_private.chart_templates%ROWTYPE;
BEGIN
 PERFORM management_private.authorize(p_business_id, ARRAY['owner', 'admin', 'editor', 'viewer']);
 SELECT * INTO adoption FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id;
 SELECT * INTO template FROM onboarding_private.chart_templates WHERE version = adoption.version;
 RETURN jsonb_build_object(
  'template', CASE WHEN adoption.business_id IS NULL THEN NULL ELSE jsonb_build_object('version', template.version,
    'status', template.status, 'reviewed_by', template.reviewed_by, 'reviewed_at', template.reviewed_at, 'adopted_at', adoption.adopted_at) END,
  'books_active', accounting.active(p_business_id),
  'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'account_type', a.account_type,
      'purpose', coalesce(m.purpose, t.purpose, k.purpose), 'flow_section', coalesce(m.flow_section, t.flow_section, k.flow_section),
      'is_active', a.is_active, 'system', t.purpose IS NOT NULL AND c.account_id IS NULL, 'added', c.account_id IS NOT NULL) ORDER BY a.code)
    FROM public.accounts a
    LEFT JOIN accounting.account_map m ON m.business_id = a.business_id AND m.account_id = a.id
    LEFT JOIN onboarding_private.custom_accounts c ON c.account_id = a.id
    LEFT JOIN onboarding_private.account_kinds k ON k.kind = c.kind
    LEFT JOIN onboarding_private.chart_template_accounts t ON t.version = adoption.version AND t.mode = adoption.mode AND t.code = a.code AND c.account_id IS NULL
    WHERE a.business_id = p_business_id), '[]'::jsonb));
END;$f$;
