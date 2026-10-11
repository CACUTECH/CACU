-- Review and apply only after the live schema reconciliation described in docs.
CREATE FUNCTION accounting.active(tenant uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY DEFINER SET search_path=pg_catalog,accounting AS $$
 SELECT EXISTS(SELECT FROM accounting.business_map WHERE business_id=tenant AND state='active');
$$;
REVOKE ALL ON FUNCTION accounting.active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.active(uuid) TO authenticated,cacu_runtime;
CREATE FUNCTION public.accounting_mode(p_business_id uuid) RETURNS text LANGUAGE plpgsql STABLE
 SECURITY DEFINER SET search_path=pg_catalog,public,accounting AS $$
BEGIN
 IF NOT public.is_business_member(p_business_id) THEN RAISE EXCEPTION 'membership required' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN accounting.active(p_business_id) THEN 'python' ELSE 'legacy' END;
END $$;
REVOKE ALL ON FUNCTION public.accounting_mode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_mode(uuid) TO authenticated;

CREATE FUNCTION accounting.legacy_guard() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog,accounting AS $$
DECLARE tenant uuid;
BEGIN
 tenant=CASE WHEN TG_OP='DELETE' THEN OLD.business_id ELSE NEW.business_id END;
 IF TG_OP='UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id AND
 (accounting.active(OLD.business_id) OR accounting.active(NEW.business_id)) THEN
  RAISE EXCEPTION 'accounting document business is immutable' USING ERRCODE='23514';
 END IF;
 IF accounting.active(tenant) AND (TG_TABLE_NAME IN ('financial_transactions','journal_entries','journal_lines') OR NOT (session_user='cacu_runtime' OR current_setting('role',true)='cacu_runtime')) THEN
  RAISE EXCEPTION 'business financial cutover requires Python accounting' USING ERRCODE='23514';
 END IF;
 IF accounting.active(tenant) AND NOT accounting.authorized_writer(tenant) THEN
  RAISE EXCEPTION 'authorized runtime writer required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
-- This narrowly scoped private definer trigger needs to inspect private cutover
-- metadata without giving browser roles USAGE on the accounting schema.
REVOKE ALL ON FUNCTION accounting.legacy_guard() FROM PUBLIC;
-- Existing legacy SECURITY DEFINER RPCs also encounter these guards.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['financial_transactions','journal_entries','journal_lines','invoices','invoice_items','payments','transactions','transaction_items','catalog_items'] LOOP
  EXECUTE format('CREATE TRIGGER accounting_cutover_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION accounting.legacy_guard()',tab);
 END LOOP;
END $$;
GRANT SELECT ON public.accounts,public.customers,public.suppliers TO cacu_runtime;
GRANT SELECT,INSERT,UPDATE ON public.invoices,public.invoice_items,public.payments,public.transactions,public.transaction_items,public.catalog_items TO cacu_runtime;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['accounts','customers','suppliers','invoice_items','invoices','payments','transactions','transaction_items','catalog_items'] LOOP
  EXECUTE format('CREATE POLICY accounting_read ON public.%I FOR SELECT TO cacu_runtime USING(accounting.authorized(business_id))',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['invoices','invoice_items','payments','transactions','transaction_items','catalog_items'] LOOP
  EXECUTE format('CREATE POLICY accounting_insert ON public.%I FOR INSERT TO cacu_runtime WITH CHECK(accounting.authorized_writer(business_id) AND accounting.active(business_id))',tab);
  EXECUTE format('CREATE POLICY accounting_update ON public.%I FOR UPDATE TO cacu_runtime USING(accounting.authorized_writer(business_id) AND accounting.active(business_id)) WITH CHECK(accounting.authorized_writer(business_id) AND accounting.active(business_id))',tab);
 END LOOP;
END $$;
