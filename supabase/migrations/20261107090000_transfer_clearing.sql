-- Transfers wait for confirmation (BR-010, Doc 09 PR-03 to PR-05, ACC-009, BL-024).
-- A transfer sale posts revenue and stock at checkout with the money in "Transfers awaiting confirmation"; a transfer
-- receipt against an invoice is held without posting, so the invoice stays outstanding. The owner (or anyone with
-- banking.post) confirms the money arrived, which moves it to the chosen bank account (and posts the held receipt),
-- or marks it not received, which reverses the sale and returns its stock. Each is decided once.
SET LOCAL search_path = accounting, public, pg_catalog;

-- id is the sale or receipt request key.
CREATE TABLE accounting.pending_transfer (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 source_type text NOT NULL CHECK (source_type IN ('pos', 'receipt')),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 entry_date date NOT NULL,
 invoice_id uuid,
 customer_id uuid,
 expected_bank_account_id uuid,
 reference text CHECK (length(reference) <= 100),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'not_received')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid, decided_at timestamptz, decided_on date, bank_account_id uuid,
 decision_note text CHECK (length(decision_note) <= 500),
 PRIMARY KEY (business_id, id),
 CHECK ((source_type = 'receipt') = (invoice_id IS NOT NULL)),
 CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL AND decided_on IS NULL)),
 CHECK ((status = 'confirmed') = (bank_account_id IS NOT NULL))
);
CREATE INDEX pending_transfer_open ON accounting.pending_transfer (business_id, entry_date) WHERE status = 'pending';
CREATE INDEX pending_transfer_invoice ON accounting.pending_transfer (business_id, invoice_id) WHERE status = 'pending';

-- Decided once: only the decision columns change, and only from pending.
CREATE FUNCTION accounting.pending_transfer_decided_once() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
  RAISE EXCEPTION 'TRANSFER_ALREADY_DECIDED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.source_type, NEW.amount, NEW.entry_date, NEW.invoice_id, NEW.created_by)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.source_type, OLD.amount, OLD.entry_date, OLD.invoice_id, OLD.created_by) THEN
  RAISE EXCEPTION 'TRANSFER_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pending_transfer_decided_once BEFORE UPDATE ON accounting.pending_transfer
 FOR EACH ROW EXECUTE FUNCTION accounting.pending_transfer_decided_once();

ALTER TABLE accounting.pending_transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.pending_transfer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.pending_transfer TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.pending_transfer TO cacu_runtime;
GRANT UPDATE (status, decided_by, decided_at, decided_on, bank_account_id, decision_note) ON accounting.pending_transfer TO cacu_runtime;

-- Doc 10 sale states: a transfer sale is pending payment until confirmed (then completed) or reversed.
DO $$
BEGIN
 IF EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.transactions'::regclass AND conname = 'transactions_status_check') THEN
  ALTER TABLE public.transactions DROP CONSTRAINT transactions_status_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
   CHECK (status IN ('completed', 'voided', 'refunded', 'pending_payment', 'reversed'));
 END IF;
END $$;
