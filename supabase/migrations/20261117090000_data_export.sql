-- Full data export (Doc 10 E22 part 2; Doc 03 FR-192; Doc 11 POST /exports, GET /exports/{id}; Doc 14 SUB-10;
-- Doc 19 TEST-009, TEST-410, NFR-035). Owner decision of 9 November 2026: the accounting API may read the business
-- tables it could not read before (staff, payroll, appointments and the like), but only for the business being
-- exported and only while its export is running.
--  * someone with settings.export (the Owner, unless granted) asks; a job builds one ZIP of CSV files within the hour;
--  * one export at a time per business, at most three a day; allowed while the workspace is read-only (SUB-10);
--  * the file is kept seven days, downloadable only by someone with settings.export in that business, then deleted.
SET LOCAL search_path = accounting, public, pg_catalog;

-- id is the request key.
CREATE TABLE accounting.data_export (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 requested_by uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 expires_at timestamptz,
 file_name text CHECK (file_name ~ '^cacu-export-[a-z0-9-]+\.zip$'),
 file bytea,
 size_bytes bigint CHECK (size_bytes >= 0),
 sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 manifest jsonb,
 error text CHECK (length(error) <= 500),
 PRIMARY KEY (business_id, id),
 CHECK (status <> 'ready' OR (file IS NOT NULL AND expires_at IS NOT NULL AND sha256 IS NOT NULL)),
 CHECK (status <> 'expired' OR file IS NULL)
);
CREATE UNIQUE INDEX data_export_one_active ON accounting.data_export (business_id) WHERE status IN ('queued', 'running');
CREATE INDEX data_export_queue ON accounting.data_export (requested_at) WHERE status = 'queued';
CREATE INDEX data_export_recent ON accounting.data_export (business_id, requested_at DESC);

-- Moves only forward: queued, running, then ready or failed; a ready file expires. Who asked and when never change.
CREATE FUNCTION accounting.data_export_moves() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$
BEGIN
 IF (NEW.business_id, NEW.id, NEW.requested_by, NEW.requested_at) IS DISTINCT FROM (OLD.business_id, OLD.id, OLD.requested_by, OLD.requested_at)
    OR NOT ((OLD.status = 'queued' AND NEW.status IN ('running', 'failed')) OR (OLD.status = 'running' AND NEW.status IN ('ready', 'failed'))
            OR (OLD.status = 'ready' AND NEW.status = 'expired') OR (OLD.status = NEW.status AND OLD.status IN ('failed', 'expired'))) THEN
  RAISE EXCEPTION 'EXPORT_STATE_INVALID' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER data_export_moves BEFORE UPDATE ON accounting.data_export FOR EACH ROW EXECUTE FUNCTION accounting.data_export_moves();
REVOKE ALL ON FUNCTION accounting.data_export_moves() FROM PUBLIC;

ALTER TABLE accounting.data_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.data_export FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.data_export TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.data_export TO cacu_runtime;
GRANT UPDATE (status, started_at, finished_at, expires_at, file_name, file, size_bytes, sha256, manifest, error) ON accounting.data_export TO cacu_runtime;

-- True only inside a running export of this business, in the API's own transaction for it, acting for the person who
-- asked while they are still an active member. A definer function: it reads memberships itself, so the export policy
-- on memberships does not call back into it.
CREATE FUNCTION accounting.exporting(tenant uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT tenant = nullif(current_setting('cacu.business_id', true), '')::uuid
  AND EXISTS (SELECT FROM accounting.data_export e
   JOIN public.memberships m ON m.business_id = e.business_id AND m.user_id = e.requested_by AND m.is_active
   WHERE e.business_id = tenant AND e.id = nullif(current_setting('cacu.export_id', true), '')::uuid AND e.status = 'running'
     AND e.requested_by = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid);
$$;
REVOKE ALL ON FUNCTION accounting.exporting(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.exporting(uuid) TO cacu_runtime;

-- Read access for exports on every business table in public: a SELECT grant where the API had none, and a policy that
-- shows the business's rows only inside its running export (memberships, for example, otherwise show the API only the
-- caller's own row). Row-level security stays on; a table without it is left alone.
DO $grant$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.oid::regclass AS rel, c.relname, c.relrowsecurity, has_table_privilege('cacu_runtime', c.oid, 'SELECT') AS readable
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped) LOOP
  IF NOT t.relrowsecurity THEN
   RAISE NOTICE 'data export: % has no row-level security; not granted', t.relname;
   CONTINUE;
  END IF;
  IF NOT t.readable THEN EXECUTE format('GRANT SELECT ON %s TO cacu_runtime', t.rel); END IF;
  EXECUTE format('CREATE POLICY export_read ON %s FOR SELECT TO cacu_runtime USING (accounting.exporting(business_id))', t.rel);
 END LOOP;
END $grant$;

-- The job's list of waiting exports across businesses, and of files past their seven days. Runtime only.
CREATE FUNCTION accounting.export_queue() RETURNS TABLE (business_id uuid, id uuid, requested_by uuid, kind text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 (SELECT e.business_id, e.id, e.requested_by, 'build' FROM accounting.data_export e WHERE e.status = 'queued' ORDER BY e.requested_at LIMIT 20)
 UNION ALL
 (SELECT e.business_id, e.id, e.requested_by, 'expire' FROM accounting.data_export e WHERE e.status = 'ready' AND e.expires_at <= now() LIMIT 200)
 UNION ALL
 -- A run that stopped part way (the job was cancelled) is failed after an hour, so the business can ask again.
 (SELECT e.business_id, e.id, e.requested_by, 'stale' FROM accounting.data_export e WHERE e.status = 'running' AND e.started_at < now() - interval '1 hour' LIMIT 200);
$$;
REVOKE ALL ON FUNCTION accounting.export_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.export_queue() TO cacu_runtime;

-- The job ends an export it cannot finish (the person who asked lost access, a run that stopped part way) or deletes a
-- file past its seven days, whoever is still in the business. Nothing else; runtime only.
CREATE FUNCTION accounting.export_settle(p_business_id uuid, p_id uuid, p_status text, p_error text DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF p_status = 'failed' THEN
  UPDATE accounting.data_export SET status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'The export could not be finished.'), 500)
   WHERE business_id = p_business_id AND id = p_id AND status IN ('queued', 'running');
 ELSIF p_status = 'expired' THEN
  UPDATE accounting.data_export SET status = 'expired', file = NULL
   WHERE business_id = p_business_id AND id = p_id AND status = 'ready' AND expires_at <= now();
 ELSE
  RAISE EXCEPTION 'EXPORT_STATE_INVALID' USING ERRCODE = '22023';
 END IF;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION accounting.export_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.export_settle(uuid, uuid, text, text) TO cacu_runtime;
