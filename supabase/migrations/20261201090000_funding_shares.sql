-- Funding readiness, part 3 (Doc 15 FRA-006..008, FR-184; E19 R3): the lender pack, shared by an expiring link.
--
-- The owner names who it is for and why, sees exactly what will be shared, and confirms (FRA-007). What they saw is
-- kept as a fixed snapshot: the management statements for the assessed period, the assessment with its explanation,
-- a data-completeness note and the business profile, nothing else (FRA-006). The lender opens that snapshot by link;
-- they never get access to the books (FRA-008). Consent expires (30 days unless the owner chooses otherwise, at most
-- 90) and can be withdrawn at any time. Every share is a row here and every opening of the link is logged (FR-184).
-- Only a SHA-256 hash of the link's token is stored, so the table cannot be used to open a pack.
-- Still off until gate G5: while accounting.funding_switch is off, no link opens.
SET LOCAL search_path = accounting, public, pg_catalog;

CREATE TABLE accounting.funding_share (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 assessment_id uuid NOT NULL REFERENCES accounting.funding_assessment(id),
 request_key uuid NOT NULL,
 recipient_name text NOT NULL CHECK (length(btrim(recipient_name)) BETWEEN 2 AND 120),
 recipient_organisation text CHECK (recipient_organisation IS NULL OR length(btrim(recipient_organisation)) BETWEEN 2 AND 120),
 purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 300),
 pack jsonb NOT NULL CHECK (jsonb_typeof(pack) = 'object'),
 pack_sha256 text NOT NULL CHECK (pack_sha256 ~ '^[0-9a-f]{64}$'),
 token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,
 withdrawn_by uuid,
 CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)),
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days 1 minute'),
 UNIQUE (business_id, request_key)
);
CREATE INDEX funding_share_recent ON accounting.funding_share (business_id, created_at DESC);

-- A share is never edited: the only change allowed is withdrawing it, once.
CREATE FUNCTION accounting.funding_share_fixed() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
    OR (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_by') IS DISTINCT FROM (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_by') THEN
  RAISE EXCEPTION 'A shared pack is never changed; it can only be withdrawn' USING ERRCODE = '55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER funding_share_fixed BEFORE UPDATE OR DELETE ON accounting.funding_share
 FOR EACH ROW EXECUTE FUNCTION accounting.funding_share_fixed();

-- Every time someone opens a link, and what they got (FR-184). Only the time is kept, never who or from where.
CREATE TABLE accounting.funding_share_access (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 share_id uuid NOT NULL REFERENCES accounting.funding_share(id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 outcome text NOT NULL CHECK (outcome IN ('opened', 'expired', 'withdrawn', 'switched_off'))
);
CREATE INDEX funding_share_access_share ON accounting.funding_share_access (business_id, share_id, opened_at DESC);

ALTER TABLE accounting.funding_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.funding_share FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting.funding_share_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.funding_share_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.funding_share TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
CREATE POLICY tenant_access ON accounting.funding_share_access TO cacu_runtime USING (accounting.authorized(business_id));
REVOKE ALL ON accounting.funding_share, accounting.funding_share_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON accounting.funding_share TO cacu_runtime;
GRANT UPDATE (withdrawn_at, withdrawn_by) ON accounting.funding_share TO cacu_runtime;
-- The access log is written only by public.funding_pack below; the API reads it.
GRANT SELECT ON accounting.funding_share_access TO cacu_runtime;

-- The business profile for the pack: its name, kind of business and address. The API cannot read public.businesses,
-- so this gives a member of the business these three fields and nothing more.
CREATE FUNCTION accounting.funding_profile(p_business_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object('name', b.name, 'business_type', to_jsonb(b) ->> 'business_type', 'address', to_jsonb(b) ->> 'address')
 FROM public.businesses b WHERE b.id = p_business_id AND accounting.authorized(p_business_id);
$$;
REVOKE ALL ON FUNCTION accounting.funding_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accounting.funding_profile(uuid) TO cacu_runtime;

-- What a lender's link shows: the fixed pack, who it was shared with and why, and when the link stops working.
-- Anyone holding the link may call it, without an account. Each call with a real link is logged; an unknown link
-- returns null and logs nothing. A withdrawn or expired link, or funding readiness switched off, returns only that.
CREATE FUNCTION public.funding_pack(p_token text) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE share accounting.funding_share; outcome text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO share FROM accounting.funding_share s WHERE s.token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
 IF NOT FOUND THEN RETURN NULL; END IF;
 outcome := CASE WHEN NOT coalesce((SELECT enabled FROM accounting.funding_switch WHERE singleton), false) THEN 'switched_off'
                 WHEN share.withdrawn_at IS NOT NULL THEN 'withdrawn'
                 WHEN share.expires_at <= now() THEN 'expired'
                 ELSE 'opened' END;
 INSERT INTO accounting.funding_share_access(business_id, share_id, outcome) VALUES (share.business_id, share.id, outcome);
 IF outcome <> 'opened' THEN RETURN jsonb_build_object('status', outcome); END IF;
 RETURN jsonb_build_object('status', 'opened', 'recipient_name', share.recipient_name, 'recipient_organisation', share.recipient_organisation,
  'purpose', share.purpose, 'shared_at', share.created_at, 'expires_at', share.expires_at, 'pack', share.pack);
END $$;
REVOKE ALL ON FUNCTION public.funding_pack(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.funding_pack(text) TO anon, authenticated;
