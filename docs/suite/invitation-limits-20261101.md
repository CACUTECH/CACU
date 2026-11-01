# R1 Rate limits on invitations - implementation review

## Scope

This covers Doc 16 SEC-026 ("Rate limits per IP and per account on sign-in, reset, invitations, exports, AI; per business on posting bursts") and threat T-11 (cost exhaustion through messaging). Here is where each part of SEC-026 stands:

| Area | Where it is limited | Status |
| --- | --- | --- |
| Invitations | Database trigger on `public.business_invitations` | Added here |
| Sign-in and password reset | Supabase Auth, because the browser calls it directly | Owner to confirm the settings below |
| AI chat | `ai_private` request limits | Already in place |
| Uploads | Upload reservation limits | Already in place |
| Exports | Built in the browser from data already loaded | No server cost; nothing to limit |
| Posting bursts (API-012, `429` with `Retry-After`) | Python API | Not done: needs `backend/app.py`, which another session is changing |

There is one migration, `20261101180000_invitation_limits.sql`. If Supabase records a different version when it is applied, rename the file to match.

## Change

- **`management_private.invitation_limit()`** runs before an invitation is created or resent. Resending is detected as a renewal of `expires_at`. It refuses with `INVITATION_LIMIT_REACHED` once any of these is reached:
  - 10 an hour by one person
  - 20 an hour for the business
  - 100 in 24 hours for the business
- **How it counts.** It counts earlier sends in `management_private.audit`, where `management_write` already records every create and resend. A per-business advisory lock stops two simultaneous sends from both getting through.
- **What isn't limited.** Cancelling and delivery-status updates aren't limited.
- **Existing rule kept.** The one-minute wait between resends of the same invitation still applies.
- **Plain messages.** The team screen showed raw codes. `management-service.ts` now turns these into plain sentences:
  - `INVITATION_LIMIT_REACHED`
  - `PLEASE_WAIT_BEFORE_RESENDING`
  - `MEMBER_ALREADY_EXISTS`
  - `INVALID_INVITATION`

  Other codes are shown as before.

## For the owner: Supabase Auth settings

Sign-in and password reset don't pass through CACU's code, so their limits are Supabase settings, under Authentication → Rate Limits and Attack Protection. Please confirm:

1. Rate limits for sign-in and sign-up and for token verification are set, not turned off.
2. Emails sent per hour, which covers password-reset and confirmation emails, is at a level you are comfortable paying for.
3. CAPTCHA protection (hCaptcha or Turnstile) is turned on for sign-in, sign-up and password reset. CACU's sign-in page would then need the CAPTCHA widget added; ask for that once the provider is chosen.
4. Leaked-password protection is turned on. The security advisor still flags it as off.

## For the reviewer

The numbers (10, 20, 100) are a proposal for pilot businesses, which invite a handful of staff. They can be changed in the migration before release.

## Verification

- `test_management_postgres.py`: one new case.
  - One person is stopped at the 11th invitation in an hour.
  - A second person can continue to the business's 20, and a resend is then refused too.
  - Cancelling still works. Sending works again an hour later, and stops at 100 in a day.
- Jest: plain messages for the limit, the resend wait and an existing member, refusals marked as not saved, and unknown codes passed through.

## Release steps

Apply the migration on staging, then production. Nothing else depends on it.
