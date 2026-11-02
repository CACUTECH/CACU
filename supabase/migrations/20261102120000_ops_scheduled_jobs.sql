-- Scheduled jobs and their run log (Doc 07 M-10 part 1; Doc 14 SUB-01, SUB-10, RSK-039). Trials are moved to General
-- hourly; unpaid businesses become read-only once a day at midnight Lagos time (23:00 UTC), never mid-trading-day.
-- Every run is logged in ops.job_runs with its result or error, so a failing job is visible rather than silent.
-- Scheduling uses pg_cron where the database has it (hosted Supabase); plain PostgreSQL (CI) gets the functions only.
SET LOCAL search_path = public, pg_catalog;

CREATE SCHEMA ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;

CREATE TABLE ops.job_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job text NOT NULL,
 started_at timestamptz NOT NULL,
 finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ok boolean NOT NULL,
 changed integer,
 error text
);
CREATE INDEX job_runs_job_idx ON ops.job_runs(job, started_at DESC);
ALTER TABLE ops.job_runs ENABLE ROW LEVEL SECURITY;

-- Runs one known job. A failure is logged and reported, not raised, so the log row survives; the job's own changes
-- are rolled back to the savepoint.
CREATE FUNCTION ops.run_job(p_job text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE started timestamptz := clock_timestamp(); n integer; message text;
BEGIN
 IF p_job NOT IN ('billing.end_trials', 'billing.suspend_unpaid') THEN
  RAISE EXCEPTION 'UNKNOWN_JOB %', p_job USING ERRCODE = '22023';
 END IF;
 BEGIN
  n := CASE p_job WHEN 'billing.end_trials' THEN platform.end_trials() ELSE platform.suspend_unpaid() END;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
  INSERT INTO ops.job_runs(job, started_at, ok, error) VALUES (p_job, started, false, left(message, 1000));
  RETURN jsonb_build_object('job', p_job, 'ok', false, 'error', left(message, 1000));
 END;
 INSERT INTO ops.job_runs(job, started_at, ok, changed) VALUES (p_job, started, true, n);
 RETURN jsonb_build_object('job', p_job, 'ok', true, 'changed', n);
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ops.run_job(text) FROM PUBLIC, anon, authenticated;

DO $schedule$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_cron') THEN
  RAISE NOTICE 'pg_cron is not available: billing jobs are not scheduled in this database';
  RETURN;
 END IF;
 CREATE EXTENSION IF NOT EXISTS pg_cron;
 PERFORM cron.schedule('cacu-billing-end-trials', '7 * * * *', $job$SELECT ops.run_job('billing.end_trials')$job$);
 PERFORM cron.schedule('cacu-billing-suspend-unpaid', '0 23 * * *', $job$SELECT ops.run_job('billing.suspend_unpaid')$job$);
END
$schedule$;
