-- Funding readiness, part 2 (Doc 15 FR-185, FRA-002, FRA-003; E19 R3): the monthly assessment and its history.
--
-- Each month CACU works out a new assessment for every business that qualifies, so the owner can see progress
-- (FRA-003). A monthly assessment is kept once per calendar month of the business's own time zone; the one on request
-- stays at most once a day. Both are written once and never changed. Still off until gate G5: the queue is empty while
-- accounting.funding_switch is off.
SET LOCAL search_path = accounting, public, pg_catalog;

-- At most one monthly assessment in a calendar month.
CREATE UNIQUE INDEX funding_assessment_one_a_month ON accounting.funding_assessment
 (business_id, (date_trunc('month', assessed_on::timestamp))) WHERE kind = 'monthly';
COMMENT ON COLUMN accounting.funding_assessment.requested_by IS 'Who asked; empty for the monthly assessment, which CACU makes itself.';

-- The businesses due a monthly assessment: funding readiness on, the plan includes it, books active, the business not
-- closed, and no monthly assessment yet this month. Returns an active owner to act for, as the export job does: the
-- job reads the books with that owner's access and nothing more. Whether a business qualifies is checked by the API
-- (FR-180), so a business that does not yet qualify is simply tried again the next day.
CREATE FUNCTION accounting.funding_monthly_queue(p_limit integer DEFAULT 200) RETURNS TABLE (business_id uuid, owner_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT m.business_id, o.user_id
 FROM accounting.business_map m
 CROSS JOIN LATERAL (SELECT p.user_id FROM public.memberships p
                     WHERE p.business_id = m.business_id AND p.role = 'owner' AND p.is_active ORDER BY p.user_id LIMIT 1) o
 WHERE m.state = 'active'
   AND coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false)
   AND accounting.funding_access(m.business_id) ->> 'level' IN ('score', 'improvement_plan', 'lender_pack')
   AND NOT platform.is_closed(m.business_id)
   AND NOT EXISTS (SELECT FROM accounting.funding_assessment a
                   WHERE a.business_id = m.business_id AND a.kind = 'monthly'
                     AND date_trunc('month', a.assessed_on::timestamp) = date_trunc('month', (now() AT TIME ZONE coalesce(m.timezone, 'Africa/Lagos'))::date::timestamp))
 ORDER BY m.business_id
 LIMIT least(greatest(p_limit, 1), 1000);
$$;
REVOKE ALL ON FUNCTION accounting.funding_monthly_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.funding_monthly_queue(integer) TO cacu_runtime;
