-- Supplier bills and payments (PR-18, PR-19) and mapping customers and suppliers added after the books went live.
--
-- Activation maps the customers and suppliers that exist at that moment to the receivables (1100) and payables
-- (2000) control accounts. Anyone added later had no mapping, so they could not be invoiced or billed.
-- accounting.map_party maps such a party to the same control account the first time it is used.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE FUNCTION accounting.map_party(tenant uuid, kind text, party uuid) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, accounting, pg_temp AS $$
DECLARE control text := CASE kind WHEN 'customers' THEN 'receivables' WHEN 'suppliers' THEN 'payables' END;
 mapped integer; accounts integer;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id', true), '')::uuid OR control IS NULL THEN
  RAISE EXCEPTION 'Invalid party scope' USING ERRCODE = '42501'; END IF;
 PERFORM 1 FROM public.memberships WHERE business_id = tenant
  AND user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
  AND is_active AND role::text IN ('owner', 'admin', 'editor') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business write permission required' USING ERRCODE = '42501'; END IF;
 PERFORM 1 FROM accounting.business_map WHERE business_id = tenant AND state = 'active';
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKS_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
 SELECT library_id INTO mapped FROM accounting.party_map WHERE business_id = tenant AND party_type = kind AND party_id = party;
 IF FOUND THEN RETURN mapped; END IF;
 IF kind = 'customers' THEN PERFORM 1 FROM public.customers WHERE id = party AND business_id = tenant;
 ELSE PERFORM 1 FROM public.suppliers WHERE id = party AND business_id = tenant; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'PARTY_UNAVAILABLE' USING ERRCODE = '22023'; END IF;
 SELECT min(library_id), count(*) INTO mapped, accounts FROM accounting.account_map WHERE business_id = tenant AND purpose = control;
 IF accounts <> 1 THEN RAISE EXCEPTION 'CONTROL_ACCOUNT_REQUIRED' USING ERRCODE = '22023'; END IF;
 INSERT INTO accounting.party_map(business_id, party_type, party_id, library_id) VALUES (tenant, kind, party, mapped);
 RETURN mapped;
END $$;
REVOKE ALL ON FUNCTION accounting.map_party(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.map_party(uuid, text, uuid) TO cacu_runtime;

-- A bill received from a supplier. id is the request key and the document_map source id. Opening bills from
-- activation have no row here; they are read from the activation evidence.
CREATE TABLE accounting.supplier_bill (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
 bill_number text NOT NULL CHECK (length(btrim(bill_number)) BETWEEN 1 AND 100),
 bill_date date NOT NULL,
 due_date date CHECK (due_date >= bill_date),
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id)
);
-- The same supplier invoice cannot be entered twice.
CREATE UNIQUE INDEX supplier_bill_number ON accounting.supplier_bill (business_id, supplier_id, lower(btrim(bill_number)));
ALTER TABLE accounting.supplier_bill ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.supplier_bill FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.supplier_bill TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.supplier_bill TO cacu_runtime;
