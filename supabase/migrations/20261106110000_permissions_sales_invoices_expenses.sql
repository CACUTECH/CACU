-- Permission model, part 2 (Doc 08 §8, Doc 07 M-08): sales, invoices, expenses, customers, suppliers, catalogue, staff
-- and outlets now also require authz.has_permission. The old role checks stay in place, so both must pass during the
-- switch; with every member on the template matching their role (part 1), nobody's access changes.
-- The functions are patched from their live definitions rather than copied: each gets one permission check right after
-- its opening BEGIN. A function that does not look as expected stops the migration instead of being skipped silently.
SET LOCAL search_path = public, pg_catalog;

-- Refuses with PERMISSION_DENIED (42501) unless the caller holds the permission.
CREATE OR REPLACE FUNCTION authz.require(p_business_id uuid, p_permission text, p_location_id uuid DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT authz.has_permission(p_business_id, p_permission, p_location_id) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED %', p_permission USING ERRCODE = '42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION authz.require(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION authz.require(uuid, text, uuid) TO authenticated, cacu_runtime;

DO $patch$
DECLARE target record; fn regprocedure; def text; head text; body text; patched text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('public.process_sale_safe(uuid,uuid,jsonb,text,numeric,uuid)', $$'sales.post'$$),
   ('public.create_invoice_safe(uuid,uuid,text,uuid,date,date,boolean,text,jsonb)',
    $$CASE WHEN p_type = 'Invoice' THEN 'invoices.post' ELSE 'invoices.create' END$$),
   ('public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text)', $$'invoices.post'$$),
   ('public.update_invoice_status_safe(uuid,uuid,text)', $$CASE WHEN p_status = 'void' THEN 'invoices.delete' ELSE 'invoices.post' END$$),
   ('public.record_ledger_entry_safe(uuid,uuid,text,numeric,text,text,date)',
    $$CASE WHEN p_type = 'Expense' THEN 'expenses.post' ELSE 'ledger.post' END$$),
   ('public.management_write(uuid,uuid,text,uuid,bigint,jsonb)',
    $$CASE WHEN p_operation = 'item.save' AND p_id IS NULL THEN 'inventory.create'
          WHEN p_operation IN ('item.save', 'category.save') THEN 'inventory.edit'
          WHEN p_operation = 'stock.adjust' THEN 'inventory.post'
          WHEN p_operation = 'invitation.create' THEN 'settings.create'
          ELSE 'settings.edit' END$$)
  ) t(signature, permission)
 LOOP
  fn := to_regprocedure(target.signature);
  IF fn IS NULL THEN
   RAISE NOTICE 'permission switch: % is not in this database; skipped', target.signature;
   CONTINUE;
  END IF;
  def := pg_get_functiondef(fn);
  CONTINUE WHEN position('authz.require' IN def) > 0;  -- already switched
  head := substring(def FROM 1 FOR position('$function$' IN def) + length('$function$') - 1);
  body := substring(def FROM position('$function$' IN def) + length('$function$'));
  IF position('$function$' IN def) = 0 OR body !~ '\mBEGIN\M' THEN
   RAISE EXCEPTION 'permission switch: % does not have the expected shape', target.signature;
  END IF;
  patched := head || regexp_replace(body, '\mBEGIN\M', 'BEGIN' || E'\n PERFORM authz.require(p_business_id, ' || target.permission || ');');
  EXECUTE patched;
 END LOOP;
END
$patch$;

-- Row security on the tables people write through the Data API: the existing rule AND the permission.
DO $policies$
DECLARE target record; pol record; using_clause text; check_clause text; perm text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('customers', 'customers'), ('suppliers', 'inventory'), ('catalog_items', 'inventory'), ('invoices', 'invoices'),
   ('transactions', 'sales'), ('appointments', 'services'), ('jobs', 'services')
  ) t(tab, module)
 LOOP
  FOR pol IN SELECT policyname, cmd, qual, with_check FROM pg_policies
              WHERE schemaname = 'public' AND tablename = target.tab AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
                AND policyname NOT LIKE 'accounting_%' LOOP
   perm := target.module || '.' || CASE pol.cmd WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'edit' ELSE 'delete' END;
   CONTINUE WHEN coalesce(pol.qual, '') || coalesce(pol.with_check, '') LIKE '%authz.has_permission%';
   using_clause := CASE WHEN pol.qual IS NOT NULL THEN format(' USING ((%s) AND authz.has_permission(business_id, %L))', pol.qual, perm) ELSE '' END;
   check_clause := CASE WHEN pol.with_check IS NOT NULL THEN format(' WITH CHECK ((%s) AND authz.has_permission(business_id, %L))', pol.with_check, perm) ELSE '' END;
   EXECUTE format('ALTER POLICY %I ON public.%I', pol.policyname, target.tab) || using_clause || check_clause;
  END LOOP;
 END LOOP;
END
$policies$;
