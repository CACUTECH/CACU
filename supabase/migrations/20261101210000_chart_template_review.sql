-- DEP-02 accountant review of the NG-2026.1 standard chart (Doc 02 DEP-02, Doc 09 section 4).
-- Signed review: docs/suite/chart-template-review-20261101.md. Approved for the R1 accounting pilot scope only.
-- The review covered the template as first released; if its accounts have changed since, this refuses to record it,
-- and the change needs a new template version and its own review.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE fingerprint text; recorded integer;
BEGIN
  SELECT md5(string_agg(concat_ws('|', mode, code, name, account_type, library_type, coalesce(purpose, ''), flow_section),
                        E'\n' ORDER BY mode, code))
    INTO fingerprint FROM onboarding_private.chart_template_accounts WHERE version = 'NG-2026.1';
  IF fingerprint IS DISTINCT FROM '48a5e1fccac6f76a55c758ff86531012' THEN
    RAISE EXCEPTION 'NG-2026.1 differs from the reviewed template (%)', fingerprint;
  END IF;
  UPDATE onboarding_private.chart_templates
     SET status = 'reviewed', reviewed_by = 'Oyewale Olayiwola (CACU Technologies Limited)',
         reviewed_at = '2026-11-01 00:00:00+01'
   WHERE version = 'NG-2026.1' AND status = 'pending_review';
  GET DIAGNOSTICS recorded = ROW_COUNT;
  IF recorded <> 1 THEN
    RAISE EXCEPTION 'NG-2026.1 is not awaiting review';
  END IF;
END $$;

COMMIT;
