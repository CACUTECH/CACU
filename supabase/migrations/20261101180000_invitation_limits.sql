-- Invitation rate limits (Doc 16 SEC-026, T-11). Resending one invitation already waits a minute; this caps how
-- many invitations a business can create or resend, so an account cannot be used to send invitation email in bulk
-- once delivery is turned on. Counts come from the management audit, which records every create and resend.
SET LOCAL search_path = public, pg_catalog;

CREATE FUNCTION management_private.invitation_limit() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hour_count integer; day_count integer; actor_count integer;
BEGIN
 -- Serialises concurrent sends for one business so the counts cannot be raced.
 PERFORM pg_advisory_xact_lock(hashtextextended('invitations:' || NEW.business_id::text, 0));
 SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
        count(*),
        count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND actor_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid)
   INTO hour_count, day_count, actor_count
   FROM management_private.audit
  WHERE business_id = NEW.business_id AND event IN ('invitation.create', 'invitation.resend') AND created_at > now() - interval '24 hours';
 IF hour_count >= 20 OR day_count >= 100 OR actor_count >= 10 THEN
  RAISE EXCEPTION 'INVITATION_LIMIT_REACHED' USING ERRCODE = 'P0001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION management_private.invitation_limit() FROM PUBLIC, anon, authenticated;

-- A new invitation, or a resend (which renews expires_at); cancelling and delivery updates are not limited.
CREATE TRIGGER invitation_limit_on_create BEFORE INSERT ON public.business_invitations
 FOR EACH ROW EXECUTE FUNCTION management_private.invitation_limit();
CREATE TRIGGER invitation_limit_on_resend BEFORE UPDATE OF expires_at ON public.business_invitations
 FOR EACH ROW WHEN (NEW.expires_at IS DISTINCT FROM OLD.expires_at) EXECUTE FUNCTION management_private.invitation_limit();
