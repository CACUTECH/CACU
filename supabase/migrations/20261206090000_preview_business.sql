-- CACU's preview business (owner decision of 26 November 2026): one business, chosen by CACU, whose Owner and Admins
-- see every module CACU has, now and as it is added, before it is released to everyone:
--   * every module in the menu, including those still held back for other businesses (HR today);
--   * the features behind CACU's own switches (payroll posting, funding readiness), on for this business only, while
--     they stay off for everyone else until their release gates.
-- Plan limits and billing are unchanged: what the business's plan includes still applies.
--
-- The list is changed only by CACU, as a reviewed production change: nobody can add a business to it through the app.
-- A new CACU switch checks accounting.is_preview(business) as well as its own setting, so the preview business gets it
-- first.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.preview_business (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id),
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
 added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE accounting.preview_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.preview_business FORCE ROW LEVEL SECURITY;
REVOKE ALL ON accounting.preview_business FROM PUBLIC, anon, authenticated;

CREATE FUNCTION accounting.is_preview(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT FROM accounting.preview_business WHERE business_id = p_business_id);
$$;
REVOKE ALL ON FUNCTION accounting.is_preview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.is_preview(uuid) TO cacu_runtime;

-- For the app's menu: whether the business is the preview business, answered only to its active members.
CREATE FUNCTION public.cacu_preview(p_business_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT FROM public.memberships m WHERE m.business_id = p_business_id AND m.user_id = auth.uid() AND m.is_active)
    AND accounting.is_preview(p_business_id);
$$;
REVOKE ALL ON FUNCTION public.cacu_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cacu_preview(uuid) TO authenticated;

-- Funding readiness: on for the preview business while accounting.funding_switch is off.
CREATE OR REPLACE FUNCTION accounting.funding_access(p_business_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object(
  'enabled', coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false) OR accounting.is_preview(p_business_id),
  'level', CASE WHEN NOT EXISTS (SELECT FROM platform.subscriptions WHERE business_id = p_business_id) THEN 'lender_pack'
                ELSE coalesce(platform.entitlement(p_business_id, 'module.funding') #>> '{}', 'false') END);
$$;

CREATE OR REPLACE FUNCTION accounting.funding_monthly_queue(p_limit integer DEFAULT 200) RETURNS TABLE (business_id uuid, owner_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT m.business_id, o.user_id
 FROM accounting.business_map m
 CROSS JOIN LATERAL (SELECT p.user_id FROM public.memberships p
                     WHERE p.business_id = m.business_id AND p.role = 'owner' AND p.is_active ORDER BY p.user_id LIMIT 1) o
 WHERE m.state = 'active'
   AND (coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false) OR accounting.is_preview(m.business_id))
   AND accounting.funding_access(m.business_id) ->> 'level' IN ('score', 'improvement_plan', 'lender_pack')
   AND NOT platform.is_closed(m.business_id)
   AND NOT EXISTS (SELECT FROM accounting.funding_assessment a
                   WHERE a.business_id = m.business_id AND a.kind = 'monthly'
                     AND date_trunc('month', a.assessed_on::timestamp) = date_trunc('month', (now() AT TIME ZONE coalesce(m.timezone, 'Africa/Lagos'))::date::timestamp))
 ORDER BY m.business_id
 LIMIT least(greatest(p_limit, 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.funding_pack(p_token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE share accounting.funding_share; outcome text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO share FROM accounting.funding_share s WHERE s.token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
 IF NOT FOUND THEN RETURN NULL; END IF;
 outcome := CASE WHEN NOT (coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false) OR accounting.is_preview(share.business_id)) THEN 'switched_off'
                 WHEN share.withdrawn_at IS NOT NULL THEN 'withdrawn'
                 WHEN share.expires_at <= now() THEN 'expired'
                 ELSE 'opened' END;
 INSERT INTO accounting.funding_share_access(business_id, share_id, outcome) VALUES (share.business_id, share.id, outcome);
 IF outcome <> 'opened' THEN RETURN jsonb_build_object('status', outcome); END IF;
 RETURN jsonb_build_object('status', 'opened', 'recipient_name', share.recipient_name, 'recipient_organisation', share.recipient_organisation,
  'purpose', share.purpose, 'shared_at', share.created_at, 'expires_at', share.expires_at, 'pack', share.pack);
END $$;
