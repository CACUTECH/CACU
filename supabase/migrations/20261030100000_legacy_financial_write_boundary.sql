-- R0 M-02 and M-04 (Docs 07/08 GAP-01, GAP-02, GAP-06).
-- Legacy financial tables are written only by reviewed SECURITY DEFINER functions or the Python core's
-- cacu_runtime role, which holds its own grants. Signed-in users keep their row-level-security reads.
-- Requires 20261012140639_inventory_user_management (legacy_private) and the accounting migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.financial_transactions, public.transactions, public.transaction_items,
  public.journal_entries, public.journal_lines, public.invoices, public.invoice_items,
  public.payments, public.payment_events, public.payment_status_history, public.accounts
FROM PUBLIC, anon, authenticated;

-- The ledger immutability trigger uses only built-in functions; pin its lookup path.
ALTER FUNCTION accounting.immutable_ledger() SET search_path = pg_catalog, pg_temp;

CREATE TABLE legacy_private.ledger_requests (
  business_id uuid NOT NULL, request_key uuid NOT NULL, actor_id uuid NOT NULL, payload_hash text NOT NULL,
  entry_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (business_id, request_key)
);
ALTER TABLE legacy_private.ledger_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_private.ledger_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON legacy_private.ledger_requests FROM PUBLIC, anon, authenticated;

-- Replaces the browser-reachable insert used by the operational ledger screen.
CREATE FUNCTION public.record_ledger_entry_safe(p_business_id uuid, p_request_key uuid, p_description text,
  p_amount numeric, p_type text, p_category text, p_date date DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid := auth.uid(); fingerprint text; previous legacy_private.ledger_requests%ROWTYPE;
 entry public.financial_transactions%ROWTYPE; today date;
BEGIN
 IF actor IS NULL OR p_business_id IS NULL
  OR NOT public.has_business_role(p_business_id, ARRAY['owner','admin','editor']::public.membership_role[]) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':ledger:' || p_request_key::text, 0));
 fingerprint := encode(sha256(convert_to(jsonb_build_array(actor, p_description, p_amount, p_type, p_category, p_date)::text, 'UTF8')), 'hex');
 SELECT * INTO previous FROM legacy_private.ledger_requests WHERE business_id = p_business_id AND request_key = p_request_key;
 IF FOUND THEN
  IF previous.actor_id <> actor OR previous.payload_hash <> fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO entry FROM public.financial_transactions WHERE id = previous.entry_id;
  RETURN to_jsonb(entry) || '{"replayed":true}'::jsonb;
 END IF;
 IF accounting.active(p_business_id) THEN RAISE EXCEPTION 'USE_ACCOUNTING_POSTINGS' USING ERRCODE = '23514'; END IF;
 today := timezone(coalesce((SELECT timezone FROM accounting.business_map WHERE business_id = p_business_id), 'Africa/Lagos'), now())::date;
 IF length(btrim(coalesce(p_description, ''))) NOT BETWEEN 1 AND 500 OR p_type IS NULL OR p_type NOT IN ('Income', 'Expense')
  OR p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000000000000 OR p_amount <> round(p_amount, 2)
  OR length(coalesce(p_category, '')) > 100 OR coalesce(p_date, today) > today THEN
  RAISE EXCEPTION 'INVALID_LEDGER_ENTRY' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.financial_transactions(business_id, description, amount, type, category, date, created_by)
  VALUES (p_business_id, btrim(p_description), p_amount, p_type, nullif(btrim(p_category), ''), coalesce(p_date, today), actor)
  RETURNING * INTO entry;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'MANUAL_JOURNAL_ENTRY', 'financial_transactions', entry.id,
   jsonb_build_object('amount', entry.amount, 'type', entry.type, 'request_key', p_request_key));
 INSERT INTO legacy_private.ledger_requests VALUES (p_business_id, p_request_key, actor, fingerprint, entry.id, now());
 RETURN to_jsonb(entry) || '{"replayed":false}'::jsonb;
END;$f$;

-- Replaces arbitrary invoice status updates (Doc 05 TD-007) with the transitions the hosted check allows.
-- Payment-driven statuses (paid) stay with record_payment_atomic.
CREATE FUNCTION public.update_invoice_status_safe(p_business_id uuid, p_invoice_id uuid, p_status text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE actor uuid := auth.uid(); inv public.invoices%ROWTYPE;
BEGIN
 IF actor IS NULL OR p_business_id IS NULL
  OR NOT public.has_business_role(p_business_id, ARRAY['owner','admin','editor']::public.membership_role[]) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 IF accounting.active(p_business_id) THEN RAISE EXCEPTION 'USE_ACCOUNTING_POSTINGS' USING ERRCODE = '23514'; END IF;
 SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id AND business_id = p_business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023'; END IF;
 IF (inv.status, p_status) NOT IN (('draft','sent'), ('draft','void'), ('sent','void'), ('overdue','void')) THEN
  RAISE EXCEPTION 'INVALID_STATUS_TRANSITION' USING ERRCODE = '22023';
 END IF;
 IF p_status = 'void' AND EXISTS (SELECT FROM public.payments WHERE invoice_id = inv.id AND business_id = p_business_id) THEN
  RAISE EXCEPTION 'INVOICE_HAS_PAYMENTS' USING ERRCODE = '23514';
 END IF;
 UPDATE public.invoices SET status = p_status, updated_at = now() WHERE id = inv.id RETURNING * INTO inv;
 INSERT INTO public.audit_logs(business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, actor, 'INVOICE_STATUS', 'invoices', inv.id, jsonb_build_object('status', p_status));
 RETURN jsonb_build_object('id', inv.id, 'status', inv.status);
END;$f$;

REVOKE ALL ON FUNCTION public.record_ledger_entry_safe(uuid, uuid, text, numeric, text, text, date),
  public.update_invoice_status_safe(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ledger_entry_safe(uuid, uuid, text, numeric, text, text, date),
  public.update_invoice_status_safe(uuid, uuid, text) TO authenticated;
COMMIT;
