-- POS, part 3 (Doc 10 sale states and refunds, Doc 09 PR-16, Doc 08 FR-044):
--  * parked sales: a cart saved to resume later (for example while a customer fetches money). Nothing is posted; prices
--    are read again from the catalogue when it is resumed. Anyone who can sell may park, resume or discard;
--  * refunds: items and quantities chosen from a completed sale, never more than was sold less earlier refunds. Revenue
--    is taken back at the line's net price, money goes back by cash or bank transfer, and resaleable goods return to
--    stock at the cost they left at. Someone with sales.approve refunds at once up to the owner's limit; anything above
--    it, and every request from someone without sales.approve, waits for approval. With separation of duties on (the
--    business's approval rules) nobody approves their own refund.
SET LOCAL search_path = public, pg_catalog;

-- Parked sales ------------------------------------------------------------------------------------------------------
CREATE TABLE public.parked_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 label text NOT NULL DEFAULT '' CHECK (length(label) <= 60),
 items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 100),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parked_sales_business ON public.parked_sales (business_id, created_at);
-- Who parked it is always the caller; it cannot be supplied.
CREATE FUNCTION public.parked_sales_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 NEW.created_by := auth.uid();
 NEW.created_at := now();
 IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE = '42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.parked_sales_stamp() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER parked_sales_stamp BEFORE INSERT ON public.parked_sales FOR EACH ROW EXECUTE FUNCTION public.parked_sales_stamp();
ALTER TABLE public.parked_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY parked_sales_read ON public.parked_sales FOR SELECT TO authenticated
 USING (authz.has_permission(business_id, 'sales.create'));
CREATE POLICY parked_sales_park ON public.parked_sales FOR INSERT TO authenticated
 WITH CHECK (authz.has_permission(business_id, 'sales.create'));
CREATE POLICY parked_sales_resume ON public.parked_sales FOR DELETE TO authenticated
 USING (authz.has_permission(business_id, 'sales.create'));
REVOKE ALL ON public.parked_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.parked_sales TO authenticated;

-- Refunds -----------------------------------------------------------------------------------------------------------
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS refunded_total numeric(15,2) NOT NULL DEFAULT 0 CHECK (refunded_total >= 0);
-- The owner's limit for refunding without a second person; no limit when empty.
ALTER TABLE accounting.sales_policy ADD COLUMN IF NOT EXISTS refund_threshold numeric(15,2) CHECK (refund_threshold >= 0);

-- id is the request key.
CREATE TABLE accounting.sale_refund (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 sale_id uuid NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 method text NOT NULL CHECK (method IN ('cash', 'transfer')),
 bank_account_id uuid,
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'rejected')),
 requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid, decided_at timestamptz, decided_on date,
 decision_note text CHECK (length(decision_note) <= 500),
 posting jsonb,
 PRIMARY KEY (business_id, id),
 CHECK (method = 'transfer' OR bank_account_id IS NULL),
 CHECK (status <> 'posted' OR method = 'cash' OR bank_account_id IS NOT NULL),
 CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL AND decided_on IS NULL))
);
CREATE INDEX sale_refund_sale ON accounting.sale_refund (business_id, sale_id);
CREATE INDEX sale_refund_open ON accounting.sale_refund (business_id, requested_at) WHERE status = 'pending';

CREATE TABLE accounting.sale_refund_line (
 business_id uuid NOT NULL,
 refund_id uuid NOT NULL,
 line_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 restock boolean NOT NULL,
 PRIMARY KEY (business_id, refund_id, line_id),
 FOREIGN KEY (business_id, refund_id) REFERENCES accounting.sale_refund(business_id, id)
);
CREATE INDEX sale_refund_line_line ON accounting.sale_refund_line (business_id, line_id);

-- Decided once: only the decision columns change, and only from pending.
CREATE FUNCTION accounting.sale_refund_decided_once() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
  RAISE EXCEPTION 'REFUND_ALREADY_DECIDED' USING ERRCODE = '23514';
 END IF;
 IF (NEW.business_id, NEW.id, NEW.sale_id, NEW.amount, NEW.method, NEW.reason, NEW.requested_by, NEW.requested_at)
    IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.sale_id, OLD.amount, OLD.method, OLD.reason, OLD.requested_by, OLD.requested_at) THEN
  RAISE EXCEPTION 'REFUND_RECORD_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sale_refund_decided_once BEFORE UPDATE ON accounting.sale_refund
 FOR EACH ROW EXECUTE FUNCTION accounting.sale_refund_decided_once();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['sale_refund', 'sale_refund_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON accounting.sale_refund, accounting.sale_refund_line TO cacu_runtime;
GRANT UPDATE (status, decided_by, decided_at, decided_on, bank_account_id, decision_note, posting) ON accounting.sale_refund TO cacu_runtime;
