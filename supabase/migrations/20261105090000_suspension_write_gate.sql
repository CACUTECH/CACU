-- Suspension is read-only (Doc 14 SUB-10). A business whose subscription is suspended, cancelled or closed can view and
-- export everything, record payments received against existing invoices and remove staff, but cannot start new
-- trading: no new sales, invoices, expenses, stock movements, catalogue, customer, supplier, outlet or staff changes.
-- Enforced by triggers on the tables themselves, so the legacy functions, management actions, direct Data API writes
-- and the Python core all meet it. The Python core also refuses native writes before posting (library_transaction).
-- Unbilled businesses (no subscription) are unaffected. Some legacy tables predate the tracked migrations, so a
-- trigger is attached only where its table exists.
SET LOCAL search_path = public, pg_catalog;

CREATE FUNCTION platform.read_only_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 -- A legacy receipt against an existing invoice records its income event here; collecting what is owed stays open.
 IF TG_TABLE_NAME = 'financial_transactions' AND to_jsonb(NEW)->>'reference_type' IS NOT DISTINCT FROM 'Payment' THEN RETURN NEW; END IF;
 -- Deactivating staff and other membership edits stay open; only bringing someone back is a new seat.
 -- (Nested: PL/pgSQL does not short-circuit, and other tables have no is_active.)
 IF TG_TABLE_NAME = 'memberships' AND TG_OP = 'UPDATE' THEN
  IF NOT (NEW.is_active AND NOT OLD.is_active) THEN RETURN NEW; END IF;
 END IF;
 IF NOT platform.writes_allowed(NEW.business_id) THEN
  RAISE EXCEPTION 'SUBSCRIPTION_READ_ONLY' USING ERRCODE = 'P0001',
   HINT = 'The workspace is read-only until the subscription is paid; payments received and exports still work';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION platform.read_only_guard() FROM PUBLIC, anon, authenticated;

DO $guard$
DECLARE target record;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   -- New trading documents.
   ('invoices', 'INSERT'), ('transactions', 'INSERT'), ('financial_transactions', 'INSERT'), ('inventory_movements', 'INSERT'),
   ('appointments', 'INSERT'), ('jobs', 'INSERT'),
   -- Records a business maintains while trading.
   ('customers', 'INSERT OR UPDATE'), ('suppliers', 'INSERT OR UPDATE'), ('catalog_items', 'INSERT OR UPDATE'),
   ('catalog_categories', 'INSERT OR UPDATE'), ('business_locations', 'INSERT OR UPDATE'),
   -- Staff and HR.
   ('business_invitations', 'INSERT'), ('memberships', 'INSERT OR UPDATE OF is_active'), ('employees', 'INSERT')
  ) t(name, events)
 LOOP
  CONTINUE WHEN to_regclass('public.' || target.name) IS NULL;
  EXECUTE format('CREATE TRIGGER %I BEFORE %s ON public.%I FOR EACH ROW EXECUTE FUNCTION platform.read_only_guard()',
                 target.name || '_read_only_when_suspended', target.events, target.name);
 END LOOP;
END
$guard$;

-- The Python core asks the same question before any native write.
GRANT USAGE ON SCHEMA platform TO cacu_runtime;
GRANT EXECUTE ON FUNCTION platform.writes_allowed(uuid) TO cacu_runtime;
