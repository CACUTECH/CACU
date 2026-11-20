-- Online invoice payments through the business's own Paystack account (Doc 10 E23, FR-220 to FR-223; Doc 09 PR-14,
-- PR-15; Doc 11 POST /payments and the Paystack webhook; BR-010). Owner decisions of 9 November 2026: the money goes to
-- the business's own Paystack account (CACU never holds it, ADR-008), and settlements are matched to the bank.
--  * an Owner or Admin connects the business's Paystack secret key. It is stored only as AES-GCM ciphertext made by
--    the accounting API under its own key, never in plain text, and is never returned to any screen;
--  * staff share a pay link for an invoice. The customer pays on Paystack's page; CACU asks Paystack's verify endpoint
--    before anything posts, whether the news came from the customer's return, the webhook or the check job;
--  * a verified payment debits Card and online payments clearing (1030) and credits the customer's receivable,
--    allocated to the invoice (PR-14). Anything paid beyond what was still owed is kept as the customer's advance;
--  * a Paystack settlement debits the bank with the net amount and Bank and payment charges (6400) with the fee, and
--    credits clearing with the gross (PR-15). Money in a settlement CACU did not take is held for review.
SET LOCAL search_path = accounting, public, pg_catalog;

DO $kinds$ BEGIN
 IF to_regclass('onboarding_private.account_kinds') IS NOT NULL THEN
  INSERT INTO onboarding_private.account_kinds(kind, account_type, library_type, flow_section, purpose, band_start, band_end, step)
  VALUES ('gateway_clearing', 'asset', 'CURRENT_ASSET', 'operating', 'gateway_clearing', 1030, 1039, 1)
  ON CONFLICT (kind) DO NOTHING;
 END IF;
END $kinds$;

-- One Paystack connection per business. webhook_token names the business in its webhook address.
CREATE TABLE accounting.payment_provider (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 provider text NOT NULL DEFAULT 'paystack' CHECK (provider = 'paystack'),
 secret_ciphertext text CHECK (secret_ciphertext IS NULL OR length(secret_ciphertext) BETWEEN 40 AND 1000),
 key_hint text CHECK (key_hint ~ '^sk_(test|live)_\.\.\.[A-Za-z0-9]{4}$'),
 mode text CHECK (mode IN ('test', 'live')),
 webhook_token text NOT NULL UNIQUE CHECK (webhook_token ~ '^[0-9a-f]{64}$'),
 settlement_bank_account_id uuid,
 connected_by uuid NOT NULL,
 connected_at timestamptz NOT NULL DEFAULT now(),
 disconnected_at timestamptz,
 CHECK ((secret_ciphertext IS NULL) = (disconnected_at IS NOT NULL)),
 CHECK (disconnected_at IS NOT NULL OR (key_hint IS NOT NULL AND mode IS NOT NULL AND settlement_bank_account_id IS NOT NULL))
);

-- A pay link for one invoice; it works until revoked. One live link per invoice.
CREATE TABLE accounting.payment_link (
 token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{64}$'),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 invoice_id uuid NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, revoked_by uuid,
 CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX payment_link_live ON accounting.payment_link (business_id, invoice_id) WHERE revoked_at IS NULL;

-- Each Paystack checkout started from a link. id is also the request key of its posting.
CREATE TABLE accounting.online_payment (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 reference text NOT NULL UNIQUE CHECK (reference ~ '^CACU-PAY-[0-9a-f]{32}$'),
 link_token text NOT NULL REFERENCES accounting.payment_link(token),
 invoice_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed', 'needs_review')),
 paid_amount numeric(15,2) CHECK (paid_amount > 0),
 fee numeric(15,2) CHECK (fee >= 0),
 paid_at timestamptz,
 channel text CHECK (length(channel) <= 40),
 review_reason text CHECK (length(review_reason) <= 300),
 posting jsonb,
 settlement_id text CHECK (length(settlement_id) <= 40),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
 PRIMARY KEY (business_id, id),
 CHECK ((status = 'posted') = (posting IS NOT NULL)),
 CHECK (status <> 'posted' OR (paid_amount IS NOT NULL AND paid_at IS NOT NULL)),
 CHECK (settlement_id IS NULL OR status = 'posted')
);
CREATE INDEX online_payment_pending ON accounting.online_payment (business_id, created_at) WHERE status = 'pending';
CREATE INDEX online_payment_invoice ON accounting.online_payment (business_id, invoice_id);

-- A checkout is decided once (pending to posted, failed or needs review); a posted payment is later settled once.
CREATE FUNCTION accounting.online_payment_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF (NEW.business_id, NEW.id, NEW.reference, NEW.link_token, NEW.invoice_id, NEW.customer_id, NEW.amount, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.reference, OLD.link_token, OLD.invoice_id, OLD.customer_id, OLD.amount, OLD.created_by, OLD.created_at) THEN
  RAISE EXCEPTION 'ONLINE_PAYMENT_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 IF OLD.status = 'pending' THEN RETURN NEW; END IF;
 IF OLD.status = 'posted' AND NEW.status = 'posted' AND OLD.settlement_id IS NULL AND NEW.settlement_id IS NOT NULL
    AND (NEW.paid_amount, NEW.fee, NEW.paid_at, NEW.posting) IS NOT DISTINCT FROM (OLD.paid_amount, OLD.fee, OLD.paid_at, OLD.posting) THEN
  RETURN NEW;
 END IF;
 -- Failed only means Paystack had no successful payment when asked; a later success is still honoured.
 IF OLD.status = 'failed' AND NEW.status IN ('posted', 'needs_review') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'ONLINE_PAYMENT_ALREADY_DECIDED' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER online_payment_moves BEFORE UPDATE ON accounting.online_payment
 FOR EACH ROW EXECUTE FUNCTION accounting.online_payment_moves();

-- Each Paystack event, stored once by its event key (Doc 11); repeats are ignored.
CREATE TABLE accounting.payment_event (
 event_key text PRIMARY KEY CHECK (length(event_key) BETWEEN 3 AND 200),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 kind text NOT NULL CHECK (length(kind) <= 80),
 reference text CHECK (length(reference) <= 200),
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);

-- Each Paystack settlement matched to the books (PR-15).
CREATE TABLE accounting.gateway_settlement (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 40),
 settled_on date NOT NULL,
 gross numeric(15,2) NOT NULL CHECK (gross >= 0),
 fee numeric(15,2) NOT NULL CHECK (fee >= 0),
 net numeric(15,2) NOT NULL,
 reported_net numeric(15,2),
 unmatched numeric(15,2) NOT NULL DEFAULT 0,
 bank_account_id uuid NOT NULL,
 status text NOT NULL CHECK (status IN ('posted', 'needs_review')),
 note text CHECK (length(note) <= 500),
 posting jsonb,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, provider_id),
 CHECK (net = gross - fee),
 CHECK ((posting IS NULL) = (gross = 0))
);

CREATE FUNCTION accounting.gateway_settlement_fixed() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'SETTLEMENT_RECORD_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER gateway_settlement_fixed BEFORE UPDATE OR DELETE ON accounting.gateway_settlement
 FOR EACH ROW EXECUTE FUNCTION accounting.gateway_settlement_fixed();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['payment_provider', 'payment_link', 'online_payment', 'payment_event', 'gateway_settlement'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.payment_provider, accounting.payment_link, accounting.online_payment, accounting.payment_event,
 accounting.gateway_settlement TO cacu_runtime;
GRANT UPDATE (secret_ciphertext, key_hint, mode, settlement_bank_account_id, connected_by, connected_at, disconnected_at)
 ON accounting.payment_provider TO cacu_runtime;
GRANT UPDATE (revoked_at, revoked_by) ON accounting.payment_link TO cacu_runtime;
GRANT UPDATE (status, paid_amount, fee, paid_at, channel, review_reason, posting, settlement_id, decided_at) ON accounting.online_payment TO cacu_runtime;

-- Who the accounting API acts as for work no signed-in person started (a customer paying, a Paystack webhook, the
-- check job): the person who shared the link or connected Paystack while they still may record payments, otherwise
-- the business owner. Only these definer functions read across businesses, and each needs a secret token or is the
-- check job's list of connected businesses; none returns key material in plain text.
CREATE FUNCTION accounting.payments_actor(p_business_id uuid, p_preferred uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(
  (SELECT m.user_id FROM public.memberships m WHERE m.business_id = p_business_id AND m.user_id = p_preferred AND m.is_active
    AND m.role::text IN ('owner', 'admin', 'editor')),
  (SELECT m.user_id FROM public.memberships m WHERE m.business_id = p_business_id AND m.is_active AND m.role::text = 'owner'
    ORDER BY m.user_id LIMIT 1));
$$;

CREATE FUNCTION accounting.payment_link_target(p_token text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('business_id', l.business_id, 'invoice_id', l.invoice_id,
   'actor', accounting.payments_actor(l.business_id, l.created_by),
   'business', jsonb_build_object('name', b.name, 'address', to_jsonb(b)->>'address', 'phone', to_jsonb(b)->>'phone_number'))
 FROM accounting.payment_link l
 JOIN accounting.payment_provider p ON p.business_id = l.business_id AND p.disconnected_at IS NULL
 JOIN public.businesses b ON b.id = l.business_id
 WHERE p_token ~ '^[0-9a-f]{64}$' AND l.token = p_token AND l.revoked_at IS NULL;
$$;

CREATE FUNCTION accounting.payment_webhook_target(p_webhook_token text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('business_id', p.business_id, 'secret', p.secret_ciphertext,
   'actor', accounting.payments_actor(p.business_id, p.connected_by))
 FROM accounting.payment_provider p
 WHERE p_webhook_token ~ '^[0-9a-f]{64}$' AND p.webhook_token = p_webhook_token AND p.disconnected_at IS NULL;
$$;

CREATE FUNCTION accounting.payment_businesses() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('business_id', p.business_id,
   'actor', accounting.payments_actor(p.business_id, p.connected_by)) ORDER BY p.business_id), '[]'::jsonb)
 FROM accounting.payment_provider p WHERE p.disconnected_at IS NULL;
$$;

REVOKE ALL ON FUNCTION accounting.payments_actor(uuid, uuid), accounting.payment_link_target(text),
 accounting.payment_webhook_target(text), accounting.payment_businesses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.payment_link_target(text), accounting.payment_webhook_target(text),
 accounting.payment_businesses() TO cacu_runtime;
