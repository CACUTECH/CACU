-- Receipts for several invoices and customer advances (Doc 10 E11, Doc 09 ACC-006, PR-10, PR-11; Doc 11 POST /receipts
-- with a multi-invoice body).
--  * one payment from a customer is split across their open invoices (oldest first unless the person recording it
--    changes the split); each invoice is cleared by its part, which never exceeds what is still owed on it;
--  * anything paid beyond the split is kept as the customer's advance in Customer deposits and advances (2100, PR-10),
--    and can later be applied to one of their invoices (PR-11) or handed back;
--  * a transfer waits in Transfers awaiting confirmation as one transfer, as a single-invoice receipt does (BR-010);
--    nothing posts and the invoices stay outstanding until it is confirmed. Its parts count as waiting on each invoice,
--    so the same money cannot be allocated twice.
SET LOCAL search_path = accounting, public, pg_catalog;

-- id is the request key that recorded the payment.
CREATE TABLE accounting.customer_receipt (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 customer_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 method text NOT NULL CHECK (method IN ('cash', 'transfer')),
 bank_account_id uuid,
 entry_date date NOT NULL,
 allocations jsonb NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
 advance numeric(15,2) NOT NULL CHECK (advance >= 0),
 status text NOT NULL CHECK (status IN ('posted', 'awaiting_transfer', 'not_received')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 posting jsonb,
 PRIMARY KEY (business_id, id),
 CHECK (method = 'transfer' OR status = 'posted')
);
CREATE INDEX customer_receipt_customer ON accounting.customer_receipt (business_id, customer_id, entry_date);
CREATE INDEX customer_receipt_waiting ON accounting.customer_receipt (business_id) WHERE status = 'awaiting_transfer';

-- A receipt is decided once: a waiting transfer becomes posted or not received; nothing else changes.
CREATE FUNCTION accounting.customer_receipt_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'awaiting_transfer' OR NEW.status NOT IN ('posted', 'not_received') THEN
  RAISE EXCEPTION 'RECEIPT_ALREADY_DECIDED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.customer_id, NEW.amount, NEW.method, NEW.entry_date, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.customer_id, OLD.amount, OLD.method, OLD.entry_date, OLD.created_by, OLD.created_at) THEN
  RAISE EXCEPTION 'RECEIPT_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_receipt_moves BEFORE UPDATE ON accounting.customer_receipt
 FOR EACH ROW EXECUTE FUNCTION accounting.customer_receipt_moves();

-- Each movement of a customer's advance: money received beyond their invoices, applied to an invoice, or handed back.
-- The balance a customer holds is the received total less what was applied or refunded; it never goes below zero.
CREATE TABLE accounting.customer_advance (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 customer_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('received', 'applied', 'refunded')),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 entry_date date NOT NULL,
 receipt_id uuid,
 invoice_id uuid,
 note text CHECK (length(note) <= 500),
 posting jsonb NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id),
 CHECK ((kind = 'applied') = (invoice_id IS NOT NULL)),
 CHECK (kind <> 'received' OR receipt_id IS NOT NULL)
);
CREATE INDEX customer_advance_customer ON accounting.customer_advance (business_id, customer_id);

CREATE FUNCTION accounting.customer_advance_fixed() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'ADVANCE_RECORD_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_advance_fixed BEFORE UPDATE OR DELETE ON accounting.customer_advance
 FOR EACH ROW EXECUTE FUNCTION accounting.customer_advance_fixed();

-- A customer's advance never goes below zero.
CREATE FUNCTION accounting.customer_advance_covered() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.kind <> 'received' AND (SELECT coalesce(sum(CASE WHEN kind = 'received' THEN amount ELSE -amount END), 0)
     FROM accounting.customer_advance WHERE business_id = NEW.business_id AND customer_id = NEW.customer_id) < 0 THEN
  RAISE EXCEPTION 'ADVANCE_EXCEEDED' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_advance_covered AFTER INSERT ON accounting.customer_advance
 FOR EACH ROW EXECUTE FUNCTION accounting.customer_advance_covered();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['customer_receipt', 'customer_advance'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.customer_receipt, accounting.customer_advance TO cacu_runtime;
GRANT UPDATE (status, bank_account_id, posting) ON accounting.customer_receipt TO cacu_runtime;

-- A transfer for several invoices waits with the other transfers.
ALTER TABLE accounting.pending_transfer DROP CONSTRAINT IF EXISTS pending_transfer_source_type_check;
ALTER TABLE accounting.pending_transfer ADD CONSTRAINT pending_transfer_source_type_check
 CHECK (source_type IN ('pos', 'receipt', 'deposit', 'customer_receipt'));
