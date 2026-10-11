-- Runtime login credentials are provisioned separately. No privileged database credentials in accounting requests.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cacu_runtime') THEN
    CREATE ROLE cacu_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- This migration only defines authorization. Library schema follows in the next migration.
