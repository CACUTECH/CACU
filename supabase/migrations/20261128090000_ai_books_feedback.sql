-- AI on the books (Doc 15 monitoring; E18 R3): "Not helpful" on an answer, for CACU's weekly review.
--
-- Metadata only, like the answer record it sits on (AI-009): one reason from a fixed list and when it was given. There
-- is no free text, so nothing from the question or the answer can be kept this way. Only the member who asked can mark
-- their own completed answer, and may change the reason. The mark goes when the answer record does, after 90 days.
-- The weekly summary is for CACU staff (database access only): counts by week and tool, with no business or person.
BEGIN;

ALTER TABLE ai_private.books_answers
  ADD COLUMN feedback text CHECK (feedback IN ('wrong_figures', 'missed_something', 'hard_to_follow', 'not_what_i_asked', 'other')),
  ADD COLUMN feedback_at timestamptz,
  ADD CONSTRAINT books_answers_feedback_time CHECK ((feedback IS NULL) = (feedback_at IS NULL));

CREATE FUNCTION ai_private.rate_books(p_business_id uuid, p_request_key uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actor uuid;
BEGIN
 actor:=ai_private.actor_for_business(p_business_id);
 IF p_request_key IS NULL OR p_reason IS NULL
 OR p_reason NOT IN ('wrong_figures', 'missed_something', 'hard_to_follow', 'not_what_i_asked', 'other') THEN
  RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 UPDATE ai_private.books_answers SET feedback=p_reason, feedback_at=now()
  WHERE actor_id=actor AND business_id=p_business_id AND request_key=p_request_key AND status='completed';
 -- Another member's answer, a failed one, or one already past 90 days: nothing to mark.
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 RETURN true;
END;
$f$;
REVOKE ALL ON FUNCTION ai_private.rate_books(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_private.rate_books(uuid, uuid, text) TO authenticated;

CREATE FUNCTION public.rate_ai_books(p_business_id uuid, p_request_key uuid, p_reason text) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $f$ SELECT ai_private.rate_books(p_business_id, p_request_key, p_reason); $f$;
REVOKE ALL ON FUNCTION public.rate_ai_books(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_ai_books(uuid, uuid, text) TO authenticated;

-- The weekly review (Doc 15 monitoring): per Lagos week and tool, how many answers, how many were flagged by the figure
-- check (AI-001), how many were marked not helpful, and why. An answer that used two tools counts once under each.
CREATE VIEW ai_private.books_feedback_weekly AS
SELECT (date_trunc('week', a.created_at AT TIME ZONE 'Africa/Lagos'))::date AS week_starting,
       coalesce(t.tool, '(no tool)') AS tool,
       count(*) AS answers,
       count(*) FILTER (WHERE a.figure_check = 'flagged') AS figures_flagged,
       count(a.feedback) AS not_helpful,
       count(*) FILTER (WHERE a.feedback = 'wrong_figures') AS wrong_figures,
       count(*) FILTER (WHERE a.feedback = 'missed_something') AS missed_something,
       count(*) FILTER (WHERE a.feedback = 'hard_to_follow') AS hard_to_follow,
       count(*) FILTER (WHERE a.feedback = 'not_what_i_asked') AS not_what_i_asked,
       count(*) FILTER (WHERE a.feedback = 'other') AS other
FROM ai_private.books_answers a
LEFT JOIN LATERAL (SELECT DISTINCT u.tool FROM unnest(a.tools) AS u(tool)) AS t ON true
WHERE a.status = 'completed'
GROUP BY 1, 2;
REVOKE ALL ON ai_private.books_feedback_weekly FROM PUBLIC, anon, authenticated;

COMMIT;
