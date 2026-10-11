SET LOCAL search_path = accounting, public, pg_catalog;
GRANT USAGE ON SCHEMA accounting, public TO cacu_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA accounting TO cacu_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA accounting TO cacu_runtime;
GRANT SELECT ON public.memberships TO cacu_runtime;
CREATE POLICY accounting_membership_self ON public.memberships FOR SELECT TO cacu_runtime
 USING (user_id = (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid);

CREATE FUNCTION accounting.lock_membership(tenant uuid, actor uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result text;
BEGIN
 IF tenant IS DISTINCT FROM nullif(current_setting('cacu.business_id',true),'')::uuid
 OR actor IS DISTINCT FROM (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid THEN
   RAISE EXCEPTION 'invalid membership scope' USING ERRCODE='42501';
 END IF;
 SELECT role::text INTO result FROM public.memberships
 WHERE business_id=tenant AND user_id=actor FOR SHARE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION accounting.lock_membership(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.lock_membership(uuid,uuid) TO cacu_runtime;

CREATE TABLE accounting.business_map (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 entity_id integer NOT NULL UNIQUE,
 timezone text NOT NULL DEFAULT 'Africa/Lagos',
 state text NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','active','blocked')),
 cutover_date date, reconciliation_evidence jsonb,
 tax_policy text NOT NULL DEFAULT 'disabled' CHECK(tax_policy='disabled'),
 FOREIGN KEY(entity_id,business_id) REFERENCES accounting.entity(id,business_id),
 CHECK(state <> 'active' OR (cutover_date IS NOT NULL AND reconciliation_evidence IS NOT NULL))
);
CREATE TABLE accounting.account_map (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 library_id integer NOT NULL,
 flow_section text NOT NULL CHECK(flow_section IN ('cash','operating','investing','financing','restricted')),
 purpose text NOT NULL,
 PRIMARY KEY(business_id,account_id), UNIQUE(business_id,library_id),
 FOREIGN KEY(library_id,business_id) REFERENCES accounting.account(id,business_id)
);
CREATE TABLE accounting.document_map (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 source_type text NOT NULL, source_id uuid NOT NULL,
 transaction_id integer NOT NULL,
 PRIMARY KEY(business_id,source_type,source_id),
 FOREIGN KEY(transaction_id,business_id) REFERENCES accounting."transaction"(id,business_id)
);
CREATE TABLE accounting.posting_requests (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 request_key uuid NOT NULL, payload_hash text NOT NULL,
 result jsonb NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,request_key)
);
CREATE TABLE accounting.audit_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 actor_id uuid NOT NULL, request_key uuid NOT NULL, event text NOT NULL,
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['business_map','account_map','document_map','posting_requests','audit_event'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON accounting.business_map,accounting.account_map TO cacu_runtime;
GRANT SELECT,INSERT ON accounting.document_map,accounting.posting_requests,accounting.audit_event TO cacu_runtime;
GRANT USAGE ON SEQUENCE accounting.audit_event_id_seq TO cacu_runtime;

-- Ledger totals are checked at the *outer* commit, not between upstream's flushes.
CREATE FUNCTION accounting.check_balanced() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog,accounting AS $$
DECLARE signed_total numeric; row_count integer;
BEGIN
 SELECT sum(CASE WHEN entry_type='DEBIT' THEN amount ELSE -amount END),count(*)
 INTO signed_total,row_count FROM accounting.ledger
 WHERE transaction_id=NEW.transaction_id AND business_id=NEW.business_id;
 IF row_count<2 OR signed_total<>0 THEN
  RAISE EXCEPTION 'unbalanced accounting posting' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_posting AFTER INSERT ON accounting.ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_balanced();
ALTER TABLE accounting.ledger ADD CHECK(amount > 0);

-- Library initializes the hash immediately after INSERT; this one initialization
-- is permitted, all changes to financial fields and subsequent hashes are denied.
CREATE FUNCTION accounting.immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.hash IS NULL AND NEW.hash IS NOT NULL
 AND (to_jsonb(OLD)-'hash')=(to_jsonb(NEW)-'hash') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'posted ledger is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON accounting.ledger
 FOR EACH ROW EXECUTE FUNCTION accounting.immutable_ledger();

-- Composite source account ownership cannot rely on a UUID FK alone.
CREATE FUNCTION accounting.check_account_mapping() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.accounts WHERE id=NEW.account_id AND business_id=NEW.business_id) THEN
  RAISE EXCEPTION 'account belongs to another business' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_mapping_owner BEFORE INSERT OR UPDATE ON accounting.account_map
 FOR EACH ROW EXECUTE FUNCTION accounting.check_account_mapping();

CREATE TABLE accounting.party_map (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 party_type text NOT NULL CHECK(party_type IN ('customers','suppliers')),
 party_id uuid NOT NULL, library_id integer NOT NULL,
 PRIMARY KEY(business_id,party_type,party_id),
 FOREIGN KEY(library_id,business_id) REFERENCES accounting.account(id,business_id)
);
CREATE TABLE accounting.reversal_map (
 business_id uuid NOT NULL REFERENCES public.businesses(id),original_id integer NOT NULL,reversal_id integer NOT NULL,
 PRIMARY KEY(business_id,original_id),UNIQUE(business_id,reversal_id),
 FOREIGN KEY(original_id,business_id) REFERENCES accounting."transaction"(id,business_id),
 FOREIGN KEY(reversal_id,business_id) REFERENCES accounting."transaction"(id,business_id)
);
CREATE TABLE accounting.stock_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,business_id uuid NOT NULL REFERENCES public.businesses(id),
 source_id uuid NOT NULL,item_id uuid NOT NULL REFERENCES public.catalog_items(id),
 quantity integer NOT NULL CHECK(quantity<>0),unit_cost numeric(19,4) NOT NULL CHECK(unit_cost>=0),
 UNIQUE(business_id,source_id,item_id),created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['party_map','reversal_map','stock_event'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))',tab);
 END LOOP;
END $$;
GRANT SELECT ON accounting.party_map TO cacu_runtime;
GRANT SELECT,INSERT ON accounting.reversal_map,accounting.stock_event TO cacu_runtime;
GRANT USAGE ON SEQUENCE accounting.stock_event_id_seq TO cacu_runtime;
-- Opening values must be explicit balanced import journals, never a second balance ledger.
REVOKE INSERT,UPDATE ON accounting.balance FROM cacu_runtime;

CREATE TABLE accounting.workflow_request (
 business_id uuid NOT NULL REFERENCES public.businesses(id),request_key uuid NOT NULL,
 payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(business_id,request_key)
);
ALTER TABLE accounting.workflow_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.workflow_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.workflow_request TO cacu_runtime USING(accounting.authorized(business_id)) WITH CHECK(accounting.authorized(business_id));
GRANT SELECT,INSERT ON accounting.workflow_request TO cacu_runtime;

CREATE FUNCTION accounting.authorized_writer(tenant uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY INVOKER SET search_path=pg_catalog,public,accounting AS $$
 SELECT accounting.authorized(tenant) AND EXISTS(SELECT FROM public.memberships m
 WHERE m.business_id=tenant AND m.user_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
 AND m.role::text IN ('owner','admin','editor'));
$$;
-- Split read and write policies; a viewer cannot insert through the shared login.
DO $$ DECLARE tab text; BEGIN
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='accounting' LOOP
  EXECUTE format('DROP POLICY tenant_access ON accounting.%I',tab);
  EXECUTE format('CREATE POLICY tenant_read ON accounting.%I FOR SELECT TO cacu_runtime USING(accounting.authorized(business_id))',tab);
  EXECUTE format('CREATE POLICY tenant_insert ON accounting.%I FOR INSERT TO cacu_runtime WITH CHECK(accounting.authorized_writer(business_id))',tab);
  EXECUTE format('CREATE POLICY tenant_update ON accounting.%I FOR UPDATE TO cacu_runtime USING(accounting.authorized_writer(business_id)) WITH CHECK(accounting.authorized_writer(business_id))',tab);
 END LOOP;
END $$;

ALTER TABLE accounting.assignment ADD CHECK(amount>0);
ALTER TABLE accounting.assignment ADD FOREIGN KEY(assigned_id,business_id)
 REFERENCES accounting."transaction"(id,business_id);
CREATE INDEX ledger_business_date ON accounting.ledger(business_id,transaction_date,post_account_id);
CREATE INDEX ledger_transaction ON accounting.ledger(business_id,transaction_id);
CREATE INDEX assignment_target ON accounting.assignment(business_id,assigned_id);
CREATE INDEX line_item_transaction ON accounting.line_item(business_id,transaction_id);

CREATE FUNCTION accounting.immutable_posted_record() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,accounting AS $$
DECLARE posted boolean;
BEGIN
 IF TG_TABLE_NAME='transaction' THEN
  SELECT EXISTS(SELECT FROM accounting.ledger WHERE transaction_id=OLD.id AND business_id=OLD.business_id) INTO posted;
 ELSIF TG_TABLE_NAME='line_item' THEN
  SELECT EXISTS(SELECT FROM accounting.ledger WHERE transaction_id=OLD.transaction_id AND business_id=OLD.business_id) INTO posted;
 ELSE
  SELECT EXISTS(SELECT FROM accounting.ledger l WHERE l.business_id=OLD.business_id AND
   (l.id=OLD.id OR l.transaction_id=OLD.id OR l.line_item_id=OLD.id OR l.post_account_id=OLD.id OR l.currency_id=OLD.id)) INTO posted;
 END IF;
 IF posted THEN RAISE EXCEPTION 'posted accounting record is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_posted_transaction BEFORE UPDATE OR DELETE ON accounting."transaction"
 FOR EACH ROW EXECUTE FUNCTION accounting.immutable_posted_record();
CREATE TRIGGER immutable_posted_line BEFORE UPDATE OR DELETE ON accounting.line_item
 FOR EACH ROW EXECUTE FUNCTION accounting.immutable_posted_record();
CREATE TRIGGER immutable_posted_root BEFORE UPDATE OR DELETE ON accounting.recyclable
 FOR EACH ROW EXECUTE FUNCTION accounting.immutable_posted_record();

CREATE FUNCTION accounting.check_posting_period() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,accounting AS $$
DECLARE period_status text; tx_type text; cutover date; business_state text;
BEGIN
 SELECT p.status::text,t.transaction_type::text INTO period_status,tx_type
 FROM accounting."transaction" t
 JOIN accounting.entity e ON e.id=t.entity_id AND e.business_id=t.business_id
 JOIN accounting.reporting_period p ON p.entity_id=e.id AND p.business_id=e.business_id
  AND p.calendar_year=extract(year from(NEW.transaction_date - make_interval(months=>e.year_start-1)))::integer
 WHERE t.id=NEW.transaction_id AND t.business_id=NEW.business_id;
 IF period_status IS NULL OR period_status='CLOSED'
 OR (period_status='ADJUSTING' AND tx_type<>'JOURNAL_ENTRY') THEN
  RAISE EXCEPTION 'accounting period does not permit posting' USING ERRCODE='23514';
 END IF;
 SELECT cutover_date,state INTO cutover,business_state FROM accounting.business_map WHERE business_id=NEW.business_id;
 IF business_state='active' AND NEW.transaction_date::date<cutover THEN
  RAISE EXCEPTION 'posting predates accounting cutover' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER posting_period AFTER INSERT ON accounting.ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_posting_period();
