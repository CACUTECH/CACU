-- Daily reconciliation of every business on the native ledger (Doc 09 §6, Doc 19 TEST-402, Gate G2). The operator
-- (tools/reconcile_books.py) runs the trial balance and cash-flow checks for each activated business and records the
-- result here. A business whose books disagree gets a reminder to its owners through the billing notification outbox,
-- and the operator run fails so CACU sees it. The checks read the books only; nothing is posted or changed.
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE ops.reconciliation_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 as_of date NOT NULL,
 ok boolean NOT NULL,
 exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
 checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_runs_business_idx ON ops.reconciliation_runs(business_id, as_of DESC);
ALTER TABLE ops.reconciliation_runs ENABLE ROW LEVEL SECURITY;

-- Businesses to check: activated on the native ledger, with an active owner the read-only check runs as.
CREATE FUNCTION ops.books_to_check() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('business_id', m.business_id, 'actor', o.user_id) ORDER BY m.business_id), '[]'::jsonb)
   FROM accounting.business_map m
   CROSS JOIN LATERAL (SELECT user_id FROM public.memberships WHERE business_id = m.business_id AND role::text = 'owner' AND is_active
                        ORDER BY user_id LIMIT 1) o
  WHERE m.state = 'active';
$$;

ALTER TABLE platform.notifications DROP CONSTRAINT notifications_kind_check,
 ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('trial_ending', 'renewal_due', 'card_declined', 'payment_due', 'suspended', 'books_exception'));

-- Records one business's result. Exceptions queue one owner reminder per business per day.
CREATE FUNCTION ops.record_reconciliation(p_business_id uuid, p_as_of date, p_exceptions jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE problems jsonb := coalesce(p_exceptions, '[]'::jsonb);
BEGIN
 IF jsonb_typeof(problems) <> 'array' THEN RAISE EXCEPTION 'RECONCILIATION_INVALID' USING ERRCODE = '22023'; END IF;
 INSERT INTO ops.reconciliation_runs(business_id, as_of, ok, exceptions) VALUES (p_business_id, p_as_of, jsonb_array_length(problems) = 0, problems);
 IF jsonb_array_length(problems) > 0 THEN
  INSERT INTO platform.notifications(business_id, kind, channel, dedupe_key, details)
  VALUES (p_business_id, 'books_exception', 'email', 'books_exception:' || p_business_id || ':' || p_as_of,
          jsonb_build_object('as_of', p_as_of, 'checks', (SELECT jsonb_agg(DISTINCT e->>'check') FROM jsonb_array_elements(problems) e)))
  ON CONFLICT (dedupe_key, channel) DO NOTHING;
 END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ops.books_to_check(), ops.record_reconciliation(uuid, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ops TO cacu_runtime;
GRANT EXECUTE ON FUNCTION ops.books_to_check(), ops.record_reconciliation(uuid, date, jsonb) TO cacu_runtime;
