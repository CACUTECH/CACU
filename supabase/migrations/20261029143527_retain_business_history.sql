-- R0 GAP-10 / M-01: retain tenant history. No business or child rows are changed.
-- Review and exercise on isolated staging before a human production release.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- Privilege denial also protects an empty business with no referencing rows.
REVOKE DELETE, TRUNCATE ON public.businesses FROM PUBLIC, anon, authenticated, cacu_runtime;
DROP POLICY IF EXISTS businesses_delete_owner_only ON public.businesses;
-- Defense in depth if a later deployment accidentally grants DELETE again.
CREATE POLICY businesses_preserve_history ON public.businesses
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- Preserve names, columns, MATCH/UPDATE actions, deferrability, validation state
-- and comments. Discover private-schema references as well as public ones.
DO $migration$
DECLARE reference record; definition text;
BEGIN
  FOR reference IN
    SELECT c.oid, c.conname, c.convalidated, n.nspname, t.relname, t.relkind,
           obj_description(c.oid, 'pg_constraint') AS description
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND c.confrelid = 'public.businesses'::regclass
      AND c.confdeltype = 'c' AND c.conparentid = 0
    ORDER BY n.nspname, t.relname, c.conname
  LOOP
    IF reference.relkind <> 'r' THEN
      RAISE EXCEPTION 'Review required for non-ordinary business reference %.%', reference.nspname, reference.relname;
    END IF;
    definition := regexp_replace(pg_get_constraintdef(reference.oid),
      ' ON DELETE CASCADE(( DEFERRABLE( INITIALLY DEFERRED)?)?( NOT VALID)?)$',
      ' ON DELETE RESTRICT\1');
    IF definition = pg_get_constraintdef(reference.oid) THEN
      RAISE EXCEPTION 'Review required for unexpected business reference %.%', reference.nspname, reference.conname;
    END IF;
    IF reference.convalidated THEN definition := definition || ' NOT VALID'; END IF;
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I %s',
      reference.nspname, reference.relname, reference.conname, reference.conname, definition);
    IF reference.description IS NOT NULL THEN
      EXECUTE format('COMMENT ON CONSTRAINT %I ON %I.%I IS %L',
        reference.conname, reference.nspname, reference.relname, reference.description);
    END IF;
    IF reference.convalidated THEN
      EXECUTE format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
        reference.nspname, reference.relname, reference.conname);
    END IF;
  END LOOP;
END;
$migration$;
COMMIT;
