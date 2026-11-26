-- Funding readiness, part 1 (Doc 15 FR-180..185, FRA-001..012; E19 R3): eligibility, the score and its explanation.
--
-- Off until gate G5 (FRA-010 lender validation, FRA-012 data protection impact assessment and counsel). CACU's switch,
-- accounting.funding_switch, starts off; turning it on is a reviewed production change.
-- What a business gets follows its plan's existing module.funding entitlement (FRA-005): "score" (General),
-- "improvement_plan" (Oga: adds recommendations and history, part 2) and "lender_pack" (Chairman: adds the pack and
-- sharing, part 3). A business not yet billed gets everything, as with other plan features.
-- Each scoring model is a fixed version (FRA-004): a change of weight or threshold is a new row, never an edit. Each
-- assessment records the version it used and is never changed afterwards.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.funding_switch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounting.funding_switch DEFAULT VALUES;

CREATE TABLE accounting.funding_model (
 version text PRIMARY KEY CHECK (version ~ '^fra-[0-9]{1,4}$'),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION accounting.funding_model_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'A funding readiness model is never changed: add a new version' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER funding_model_fixed BEFORE UPDATE OR DELETE ON accounting.funding_model
 FOR EACH ROW EXECUTE FUNCTION accounting.funding_model_fixed();

-- Version 1 (Doc 15 "Funding readiness scoring"): starting points from common small-business lending practice, not
-- calibrated; they must be validated with lender partners and pilot data before release (FRA-010).
-- Each measure maps linearly from its "worst" value (0) to its "best" value (100) and is clipped.
-- Doc 15 gives no zero point for D4's profitable months; 25% (3 of 12 months) is CACU's assumption, flagged for review.
INSERT INTO accounting.funding_model (version, definition) VALUES ('fra-1', '{
 "period_months": 12,
 "eligibility": {"full_months": 6, "exception_age_days": 30},
 "weights": {"D1": 20, "D2": 15, "D3": 10, "D4": 20, "D5": 15, "D6": 10, "D7": 10},
 "measures": {
  "days_recorded":        {"best": "95",   "worst": "40"},
  "open_exceptions":      {"best": "0",    "worst": "10"},
  "revenue_cv":           {"best": "0.15", "worst": "0.80"},
  "revenue_growth":       {"best": "15",   "worst": "-30"},
  "net_margin":           {"best": "15",   "worst": "-10"},
  "profitable_months":    {"best": "83.3", "worst": "25"},
  "positive_cash_months": {"best": "80",   "worst": "30"},
  "cash_cover_days":      {"best": "30",   "worst": "3"},
  "debt_cover":           {"best": "2.0",  "worst": "1.0"},
  "overdue_60_share":     {"best": "10",   "worst": "50"},
  "top_customer_share":   {"best": "20",   "worst": "70"}
 },
 "bands": [{"from": 80, "band": "strong"}, {"from": 60, "band": "developing"}, {"from": 40, "band": "early"}, {"from": 0, "band": "not_yet_ready"}]
}'::jsonb);

CREATE TABLE accounting.funding_assessment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 model_version text NOT NULL REFERENCES accounting.funding_model(version),
 kind text NOT NULL CHECK (kind IN ('request', 'monthly')),
 assessed_on date NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL CHECK (period_end >= period_start),
 score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
 band text NOT NULL CHECK (band IN ('strong', 'developing', 'early', 'not_yet_ready')),
 result jsonb NOT NULL,
 requested_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 -- On request at most once a day (FRA-003); the monthly run is part 2.
 UNIQUE (business_id, kind, assessed_on)
);
CREATE INDEX funding_assessment_latest ON accounting.funding_assessment (business_id, created_at DESC);

ALTER TABLE accounting.funding_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.funding_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.funding_assessment TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
REVOKE ALL ON accounting.funding_switch, accounting.funding_model, accounting.funding_assessment FROM PUBLIC, anon, authenticated;
GRANT SELECT ON accounting.funding_switch, accounting.funding_model TO cacu_runtime;
-- Assessments are written once and never changed or removed by the API.
GRANT SELECT, INSERT ON accounting.funding_assessment TO cacu_runtime;

-- Whether funding readiness is on, and what this business's plan includes.
CREATE FUNCTION accounting.funding_access(p_business_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object(
  'enabled', coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false),
  'level', CASE WHEN NOT EXISTS (SELECT FROM platform.subscriptions WHERE business_id = p_business_id) THEN 'lender_pack'
                ELSE coalesce(platform.entitlement(p_business_id, 'module.funding') #>> '{}', 'false') END);
$$;
REVOKE ALL ON FUNCTION accounting.funding_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.funding_access(uuid) TO cacu_runtime;
