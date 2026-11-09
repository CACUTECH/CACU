-- Credit notes on invoices (Doc 10 E12, Doc 02 BP-06, Doc 09 PR-16 and ACC-010, Doc 11 POST /credit-notes):
--  * a credit note is asked for on an issued invoice: units given back from a line (credited at what is left on the
--    line per unit) or an amount taken off a line (a price allowance). Never more than the invoice charged, less earlier
--    credit notes, waiting ones included;
--  * an Owner or Admin posts it at once up to the owner's refund limit; above it, and for anyone else, it waits for an
--    Owner or Admin. With separation of duties on, nobody approves their own credit note;
--  * posting debits revenue and credits the customer's receivable, allocated to the invoice, up to what is still owed.
--    Anything beyond that (the invoice was already paid) is kept as the customer's advance in Customer deposits and
--    advances (2100), to apply to another invoice or hand back (E11). Goods given back return to stock at the cost they
--    left at.
SET LOCAL search_path = accounting, public, pg_catalog;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS credited_total numeric(15,2) NOT NULL DEFAULT 0 CHECK (credited_total >= 0);

-- id is the request key; number is the business's own credit note number (CN-0001, ...).
CREATE TABLE accounting.invoice_credit (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 number text NOT NULL CHECK (number ~ '^CN-[0-9]{4,}$'),
 invoice_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'rejected')),
 requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid, decided_at timestamptz, decided_on date,
 decision_note text CHECK (length(decision_note) <= 500),
 against_invoice numeric(15,2) CHECK (against_invoice >= 0),
 to_advance numeric(15,2) CHECK (to_advance >= 0),
 posting jsonb,
 PRIMARY KEY (business_id, id),
 UNIQUE (business_id, number),
 CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL AND decided_on IS NULL)),
 CHECK (status <> 'posted' OR (against_invoice IS NOT NULL AND to_advance IS NOT NULL AND against_invoice + to_advance = amount))
);
CREATE INDEX invoice_credit_invoice ON accounting.invoice_credit (business_id, invoice_id);
CREATE INDEX invoice_credit_open ON accounting.invoice_credit (business_id, requested_at) WHERE status = 'pending';

-- One row per invoice line: units given back (quantity > 0) or an amount off the line (quantity = 0, never restocked).
CREATE TABLE accounting.invoice_credit_line (
 business_id uuid NOT NULL,
 credit_id uuid NOT NULL,
 line_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity >= 0),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 restock boolean NOT NULL,
 PRIMARY KEY (business_id, credit_id, line_id),
 FOREIGN KEY (business_id, credit_id) REFERENCES accounting.invoice_credit(business_id, id),
 CHECK (quantity > 0 OR NOT restock)
);
CREATE INDEX invoice_credit_line_line ON accounting.invoice_credit_line (business_id, line_id);

-- Decided once: only the decision columns change, and only from pending.
CREATE FUNCTION accounting.invoice_credit_decided_once() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
  RAISE EXCEPTION 'CREDIT_NOTE_ALREADY_DECIDED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.number, NEW.invoice_id, NEW.customer_id, NEW.amount, NEW.reason, NEW.requested_by, NEW.requested_at)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.number, OLD.invoice_id, OLD.customer_id, OLD.amount, OLD.reason, OLD.requested_by, OLD.requested_at) THEN
  RAISE EXCEPTION 'CREDIT_NOTE_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_credit_decided_once BEFORE UPDATE ON accounting.invoice_credit
 FOR EACH ROW EXECUTE FUNCTION accounting.invoice_credit_decided_once();
CREATE FUNCTION accounting.invoice_credit_line_fixed() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'CREDIT_NOTE_RECORD_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER invoice_credit_line_fixed BEFORE UPDATE OR DELETE ON accounting.invoice_credit_line
 FOR EACH ROW EXECUTE FUNCTION accounting.invoice_credit_line_fixed();
REVOKE ALL ON FUNCTION accounting.invoice_credit_decided_once(), accounting.invoice_credit_line_fixed() FROM PUBLIC;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['invoice_credit', 'invoice_credit_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.invoice_credit, accounting.invoice_credit_line TO cacu_runtime;
GRANT UPDATE (status, decided_by, decided_at, decided_on, decision_note, against_invoice, to_advance, posting) ON accounting.invoice_credit TO cacu_runtime;

-- A credit beyond what the invoice still owed is kept as the customer's advance; it names the credit note it came from.
ALTER TABLE accounting.customer_advance ADD COLUMN IF NOT EXISTS credit_id uuid;
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'accounting.customer_advance'::regclass AND contype = 'c'
  AND pg_get_constraintdef(oid) ~ 'receipt_id IS NOT NULL' AND pg_get_constraintdef(oid) !~ 'credit_id';
 IF c IS NULL THEN RAISE EXCEPTION 'customer_advance receipt check not found'; END IF;
 EXECUTE format('ALTER TABLE accounting.customer_advance DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE accounting.customer_advance ADD CONSTRAINT customer_advance_received_source
 CHECK (kind <> 'received' OR (receipt_id IS NOT NULL) <> (credit_id IS NOT NULL));
