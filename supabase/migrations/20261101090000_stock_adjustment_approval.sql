-- Stock adjustments with approval (FR-080, BR-021, Doc 08 separation of duties, Doc 10 "Requested -> Approved
-- (posts) or Rejected; below threshold posts directly"). Expenses (FR-120) and reversals (FR-112) need no new
-- tables: they post through the existing accounting tables.
--
-- approval_policy: one row per business, set by the Owner. No row means owners and admins post adjustments
-- directly, as before this migration; editors' adjustments always wait for an Owner or Admin. With a threshold,
-- owner and admin adjustments above it wait too. separation_of_duties stops a requester approving their own.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.approval_policy (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 stock_threshold numeric(15,2) CHECK (stock_threshold >= 0),
 separation_of_duties boolean NOT NULL DEFAULT true,
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

-- id is the request key; once approved it is also the inventory movement and document_map source id.
CREATE TABLE accounting.stock_adjustment (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 item_id uuid NOT NULL REFERENCES public.catalog_items(id),
 delta integer NOT NULL CHECK (delta <> 0 AND abs(delta) <= 1000000),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 entry_date date NOT NULL,
 unit_cost numeric(19,4) NOT NULL CHECK (unit_cost >= 0),
 value numeric(15,2) NOT NULL CHECK (value >= 0),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'rejected')),
 requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid, decided_at timestamptz, decision_note text CHECK (length(decision_note) <= 500),
 PRIMARY KEY (business_id, id),
 CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL))
);
CREATE INDEX stock_adjustment_pending ON accounting.stock_adjustment (business_id, requested_at) WHERE status = 'pending';

-- A request is decided once; only the decision columns may change, and only from pending.
CREATE FUNCTION accounting.stock_adjustment_decided_once() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
  RAISE EXCEPTION 'ADJUSTMENT_ALREADY_DECIDED' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_adjustment_decided_once BEFORE UPDATE ON accounting.stock_adjustment
 FOR EACH ROW EXECUTE FUNCTION accounting.stock_adjustment_decided_once();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['approval_policy', 'stock_adjustment'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
 END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON accounting.approval_policy TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.stock_adjustment TO cacu_runtime;
GRANT UPDATE (status, decided_by, decided_at, decision_note) ON accounting.stock_adjustment TO cacu_runtime;
