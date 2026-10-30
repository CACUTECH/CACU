-- Start your books: opening position capture and approval (Doc 03 FR-012, Doc 09 PR-01, ACC-016, section 8
-- steps 4 and 6; Doc 12 SCR-03, UJ-03; DEC-004). Posting the approved journal happens at activation, which is a
-- reviewed privileged step (Doc 09 section 8 step 7, RB-05); nothing here writes the ledger.
-- Stock is valued on the server from the catalogue (quantity x cost price of tracked products), so the opening
-- inventory always equals the item records (ACC-013). Owner's money is the difference between what the business
-- owns and owes: the "money you put in" answer goes to capital and the rest to retained earnings, so opening
-- balance equity (3900) ends at zero as Doc 09 section 4 requires.
-- Requires 20261031100000_default_chart_of_accounts.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE onboarding_private.opening_positions (
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE RESTRICT, version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
  as_of date NOT NULL, answers jsonb NOT NULL, summary jsonb NOT NULL, journal jsonb NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), request_key uuid NOT NULL, payload_hash text NOT NULL,
  approved_by uuid, approved_at timestamptz, approval_note text,
  PRIMARY KEY (business_id, version), UNIQUE (business_id, request_key),
  CHECK ((status = 'draft') = (approved_by IS NULL) OR status = 'superseded')
);
CREATE UNIQUE INDEX opening_positions_one_open ON onboarding_private.opening_positions (business_id) WHERE status IN ('draft', 'approved');
ALTER TABLE onboarding_private.opening_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_private.opening_positions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON onboarding_private.opening_positions FROM PUBLIC, anon, authenticated;

-- Approved rows are immutable apart from being superseded by a newer version (DB-012).
CREATE FUNCTION onboarding_private.opening_position_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPENING_POSITION_IMMUTABLE' USING ERRCODE = '23514'; END IF;
 IF OLD.status = 'superseded' OR (OLD.status = 'approved' AND (NEW.status <> 'superseded'
    OR (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status'))) THEN
  RAISE EXCEPTION 'OPENING_POSITION_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;$f$;
CREATE TRIGGER opening_position_guard BEFORE UPDATE OR DELETE ON onboarding_private.opening_positions
 FOR EACH ROW EXECUTE FUNCTION onboarding_private.opening_position_guard();

-- Account ids of the adopted chart by code, and the bank-purpose accounts (from the reviewed mapping when present).
CREATE FUNCTION onboarding_private.chart_account(p_business_id uuid, p_code text) RETURNS uuid
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT id FROM public.accounts WHERE business_id = p_business_id AND code = p_code AND is_active $$;
CREATE FUNCTION onboarding_private.bank_accounts(p_business_id uuid) RETURNS TABLE(id uuid, name text)
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT a.id, a.name FROM public.accounts a
  JOIN onboarding_private.chart_adoptions d ON d.business_id = a.business_id
  LEFT JOIN accounting.account_map m ON m.business_id = a.business_id AND m.account_id = a.id
  LEFT JOIN onboarding_private.chart_template_accounts t ON t.version = d.version AND t.mode = d.mode AND t.code = a.code
  WHERE a.business_id = p_business_id AND a.is_active AND coalesce(m.purpose, t.purpose) = 'bank' ORDER BY a.code $$;
CREATE FUNCTION onboarding_private.stock_value(p_business_id uuid) RETURNS numeric
 LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(sum(round(greatest(stock_quantity, 0) * coalesce(cost_price, 0), 2)), 0) FROM public.catalog_items
  WHERE business_id = p_business_id AND is_active AND item_type = 'PRODUCT' AND track_stock $$;

CREATE FUNCTION onboarding_private.money(p_value text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v numeric;
BEGIN
 IF p_value IS NULL OR p_value = '' THEN RETURN 0; END IF;
 IF p_value !~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023'; END IF;
 v := p_value::numeric; RETURN v;
END $$;

-- p_answers: {"as_of": "YYYY-MM-DD", "cash": "0.00", "banks": [{"account_id": uuid, "amount": "0.00"}],
--  "customers": [{"customer_id": uuid, "amount": "0.00"}], "suppliers": [{"supplier_id": uuid, "amount": "0.00"}],
--  "loans": "0.00", "capital": "0.00", "notes": ""}. p_version is the version being edited (0 for the first).
CREATE FUNCTION public.save_opening_position(p_business_id uuid, p_request_key uuid, p_version integer, p_answers jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; fingerprint text; previous onboarding_private.opening_positions%ROWTYPE; current_row onboarding_private.opening_positions%ROWTYPE;
 today date; v_as_of date; cash numeric; banks numeric := 0; stock numeric; owed_to_us numeric := 0; owed_by_us numeric := 0; loans numeric;
 capital numeric; equity numeric; retained numeric; lines jsonb := '[]'::jsonb; item jsonb; amount numeric; v_name text; v_id uuid;
 next_version integer; saved onboarding_private.opening_positions%ROWTYPE;
BEGIN
 IF p_business_id IS NULL OR p_request_key IS NULL OR p_version IS NULL OR jsonb_typeof(p_answers) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
 END IF;
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 fingerprint := encode(sha256(convert_to(jsonb_build_array(actor, p_version, p_answers)::text, 'UTF8')), 'hex');
 SELECT * INTO previous FROM onboarding_private.opening_positions WHERE business_id = p_business_id AND request_key = p_request_key;
 IF FOUND THEN
  IF previous.payload_hash <> fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  RETURN public.opening_position(p_business_id) || '{"replayed": true}'::jsonb;
 END IF;
 IF accounting.active(p_business_id) OR EXISTS (SELECT FROM accounting.business_map WHERE business_id = p_business_id AND state <> 'staged') THEN
  RAISE EXCEPTION 'BOOKS_ALREADY_SET_UP' USING ERRCODE = '23514';
 END IF;
 IF NOT EXISTS (SELECT FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id) THEN
  RAISE EXCEPTION 'CHART_REQUIRED' USING ERRCODE = '23514';
 END IF;
 SELECT * INTO current_row FROM onboarding_private.opening_positions WHERE business_id = p_business_id AND status IN ('draft', 'approved');
 IF coalesce(current_row.version, 0) <> p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = '40001'; END IF;

 today := timezone(coalesce((SELECT timezone FROM accounting.business_map WHERE business_id = p_business_id), 'Africa/Lagos'), now())::date;
 BEGIN
  v_as_of := coalesce(nullif(p_answers->>'as_of', '')::date, today);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023';
 END;
 IF v_as_of > today OR length(coalesce(p_answers->>'notes', '')) > 2000 THEN RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023'; END IF;
 IF jsonb_typeof(coalesce(p_answers->'banks', '[]')) <> 'array' OR jsonb_typeof(coalesce(p_answers->'customers', '[]')) <> 'array'
    OR jsonb_typeof(coalesce(p_answers->'suppliers', '[]')) <> 'array'
    OR jsonb_array_length(coalesce(p_answers->'customers', '[]')) > 500 OR jsonb_array_length(coalesce(p_answers->'suppliers', '[]')) > 500 THEN
  RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023';
 END IF;

 cash := onboarding_private.money(p_answers->>'cash');
 IF cash > 0 THEN
  lines := lines || jsonb_build_object('code', '1000', 'account_id', onboarding_private.chart_account(p_business_id, '1000'), 'side', 'debit', 'amount', cash::text);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_answers->'banks', '[]')) LOOP
  amount := onboarding_private.money(item->>'amount');
  SELECT b.id, b.name INTO v_id, v_name FROM onboarding_private.bank_accounts(p_business_id) b WHERE b.id::text = item->>'account_id';
  IF v_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF amount > 0 THEN
   banks := banks + amount;
   lines := lines || jsonb_build_object('code', (SELECT code FROM public.accounts WHERE id = v_id), 'account_id', v_id, 'side', 'debit', 'amount', amount::text);
  END IF;
  v_id := NULL;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'account_id') FROM jsonb_array_elements(coalesce(p_answers->'banks', '[]'))) <> jsonb_array_length(coalesce(p_answers->'banks', '[]')) THEN
  RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023';
 END IF;
 stock := onboarding_private.stock_value(p_business_id);
 IF stock > 0 THEN
  IF onboarding_private.chart_account(p_business_id, '1200') IS NULL THEN RAISE EXCEPTION 'CHART_REQUIRED' USING ERRCODE = '23514'; END IF;
  lines := lines || jsonb_build_object('code', '1200', 'account_id', onboarding_private.chart_account(p_business_id, '1200'), 'side', 'debit', 'amount', stock::text);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_answers->'customers', '[]')) LOOP
  amount := onboarding_private.money(item->>'amount');
  IF NOT EXISTS (SELECT FROM public.customers WHERE id::text = item->>'customer_id' AND business_id = p_business_id) THEN
   RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF amount > 0 THEN
   owed_to_us := owed_to_us + amount;
   lines := lines || jsonb_build_object('code', '1100', 'account_id', onboarding_private.chart_account(p_business_id, '1100'), 'side', 'debit',
    'amount', amount::text, 'party_type', 'customers', 'party_id', item->>'customer_id');
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_answers->'suppliers', '[]')) LOOP
  amount := onboarding_private.money(item->>'amount');
  IF NOT EXISTS (SELECT FROM public.suppliers WHERE id::text = item->>'supplier_id' AND business_id = p_business_id) THEN
   RAISE EXCEPTION 'SUPPLIER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF amount > 0 THEN
   owed_by_us := owed_by_us + amount;
   lines := lines || jsonb_build_object('code', '2000', 'account_id', onboarding_private.chart_account(p_business_id, '2000'), 'side', 'credit',
    'amount', amount::text, 'party_type', 'suppliers', 'party_id', item->>'supplier_id');
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'customer_id') FROM jsonb_array_elements(coalesce(p_answers->'customers', '[]'))) <> jsonb_array_length(coalesce(p_answers->'customers', '[]'))
    OR (SELECT count(DISTINCT value->>'supplier_id') FROM jsonb_array_elements(coalesce(p_answers->'suppliers', '[]'))) <> jsonb_array_length(coalesce(p_answers->'suppliers', '[]')) THEN
  RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023';
 END IF;
 loans := onboarding_private.money(p_answers->>'loans');
 IF loans > 0 THEN
  lines := lines || jsonb_build_object('code', '2500', 'account_id', onboarding_private.chart_account(p_business_id, '2500'), 'side', 'credit', 'amount', loans::text);
 END IF;
 capital := onboarding_private.money(p_answers->>'capital');
 equity := cash + banks + stock + owed_to_us - owed_by_us - loans;
 retained := equity - capital;
 IF capital > 0 THEN
  lines := lines || jsonb_build_object('code', '3000', 'account_id', onboarding_private.chart_account(p_business_id, '3000'), 'side', 'credit', 'amount', capital::text);
 END IF;
 IF retained <> 0 THEN
  lines := lines || jsonb_build_object('code', '3200', 'account_id', onboarding_private.chart_account(p_business_id, '3200'),
   'side', CASE WHEN retained > 0 THEN 'credit' ELSE 'debit' END, 'amount', abs(retained)::text);
 END IF;
 IF EXISTS (SELECT FROM jsonb_array_elements(lines) l WHERE l->>'account_id' IS NULL) THEN RAISE EXCEPTION 'CHART_REQUIRED' USING ERRCODE = '23514'; END IF;

 next_version := coalesce((SELECT max(version) FROM onboarding_private.opening_positions WHERE business_id = p_business_id), 0) + 1;
 UPDATE onboarding_private.opening_positions SET status = 'superseded' WHERE business_id = p_business_id AND status = 'approved';
 UPDATE onboarding_private.opening_positions SET status = 'superseded' WHERE business_id = p_business_id AND status = 'draft';
 INSERT INTO onboarding_private.opening_positions(business_id, version, status, as_of, answers, summary, journal, created_by, request_key, payload_hash)
  VALUES (p_business_id, next_version, 'draft', v_as_of, p_answers,
   jsonb_build_object('cash', cash::text, 'banks', banks::text, 'stock', stock::text, 'customers', owed_to_us::text,
     'owns', (cash + banks + stock + owed_to_us)::text, 'suppliers', owed_by_us::text, 'loans', loans::text,
     'owes', (owed_by_us + loans)::text, 'owner_equity', equity::text, 'capital', capital::text, 'retained', retained::text),
   jsonb_build_object('entry_date', v_as_of, 'lines', lines), actor, p_request_key, fingerprint)
  RETURNING * INTO saved;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'OPENING_POSITION_SAVED', 'opening_positions', p_business_id,
   jsonb_build_object('version', saved.version, 'owner_equity', equity::text, 'request_key', p_request_key));
 RETURN public.opening_position(p_business_id) || '{"replayed": false}'::jsonb;
END;$f$;

-- Owner or Admin approves exactly the version they reviewed (DEC-004, ACC-016).
CREATE FUNCTION public.approve_opening_position(p_business_id uuid, p_version integer, p_note text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid; row_ onboarding_private.opening_positions%ROWTYPE;
BEGIN
 actor := management_private.authorize(p_business_id, ARRAY['owner', 'admin'], true);
 SELECT * INTO row_ FROM onboarding_private.opening_positions WHERE business_id = p_business_id AND version = p_version;
 IF NOT FOUND OR row_.status = 'superseded' THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = '40001'; END IF;
 IF row_.status = 'approved' THEN RETURN public.opening_position(p_business_id) || '{"replayed": true}'::jsonb; END IF;
 IF accounting.active(p_business_id) THEN RAISE EXCEPTION 'BOOKS_ALREADY_SET_UP' USING ERRCODE = '23514'; END IF;
 IF length(coalesce(p_note, '')) > 1000 THEN RAISE EXCEPTION 'INVALID_OPENING_POSITION' USING ERRCODE = '22023'; END IF;
 UPDATE onboarding_private.opening_positions SET status = 'approved', approved_by = actor, approved_at = now(), approval_note = nullif(btrim(p_note), '')
  WHERE business_id = p_business_id AND version = p_version;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'OPENING_POSITION_APPROVED', 'opening_positions', p_business_id,
   jsonb_build_object('version', p_version, 'owner_equity', row_.summary->>'owner_equity'));
 RETURN public.opening_position(p_business_id) || '{"replayed": false}'::jsonb;
END;$f$;

-- Owners and Admins see the current position with what they need to answer the questions.
CREATE FUNCTION public.opening_position(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE row_ onboarding_private.opening_positions%ROWTYPE;
BEGIN
 PERFORM management_private.authorize(p_business_id, ARRAY['owner', 'admin']);
 SELECT * INTO row_ FROM onboarding_private.opening_positions WHERE business_id = p_business_id AND status IN ('draft', 'approved');
 RETURN jsonb_build_object(
  'chart_ready', EXISTS (SELECT FROM onboarding_private.chart_adoptions WHERE business_id = p_business_id),
  'books_active', accounting.active(p_business_id),
  'stock_value', onboarding_private.stock_value(p_business_id)::text,
  'bank_accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name)) FROM onboarding_private.bank_accounts(p_business_id) b), '[]'::jsonb),
  'customers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM public.customers WHERE business_id = p_business_id), '[]'::jsonb),
  'suppliers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM public.suppliers WHERE business_id = p_business_id), '[]'::jsonb),
  'position', CASE WHEN row_.version IS NULL THEN NULL ELSE jsonb_build_object('version', row_.version, 'status', row_.status,
    'as_of', row_.as_of, 'answers', row_.answers, 'summary', row_.summary,
    'journal', (SELECT jsonb_build_object('entry_date', row_.journal->'entry_date',
                  'lines', coalesce(jsonb_agg(l.v || jsonb_build_object('name', a.name) ORDER BY l.n), '[]'::jsonb))
                FROM jsonb_array_elements(row_.journal->'lines') WITH ORDINALITY l(v, n)
                LEFT JOIN public.accounts a ON a.id = (l.v->>'account_id')::uuid),
    'approved_at', row_.approved_at,
    'approved_by', (SELECT coalesce(m.display_name, 'Team member') FROM public.memberships m WHERE m.business_id = p_business_id AND m.user_id = row_.approved_by LIMIT 1)) END);
END;$f$;

REVOKE ALL ON FUNCTION public.save_opening_position(uuid, uuid, integer, jsonb), public.approve_opening_position(uuid, integer, text),
  public.opening_position(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_opening_position(uuid, uuid, integer, jsonb), public.approve_opening_position(uuid, integer, text),
  public.opening_position(uuid) TO authenticated;
REVOKE ALL ON FUNCTION onboarding_private.chart_account(uuid, text), onboarding_private.bank_accounts(uuid),
  onboarding_private.stock_value(uuid), onboarding_private.money(text) FROM PUBLIC, anon, authenticated;
COMMIT;
