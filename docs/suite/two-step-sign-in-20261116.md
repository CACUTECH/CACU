# Two-step sign-in (Doc 10 E22 part 1, Doc 16 SEC-014)

Doc 16 rates owner account takeover (T-01, RSK-041) high likelihood, high impact, and asks for MFA in R2: required for the top plan's owners and admins, with recovery codes.

**Owner decisions of 9 November 2026:**
- E22 is built in four parts, this one first: two-step sign-in, data export, closing a business, then support access.
- Two-step sign-in is optional for everyone, and required for Owners and Admins on Chairman.
- When a business closes, the owner has 90 days to export (used in part 3).

## What people see

**Settings › Two-step sign-in** (`/settings/security`):
- **Setting up:** scan the QR code, or type the key, in an authenticator app (Google Authenticator, Microsoft Authenticator or similar), then enter the 6-digit code to turn it on.
- **Recovery codes:** ten single-use codes are then shown once, to copy or download.
- **Managing it:** the page shows how many codes are left, and makes new ones (the old ones stop working).
- **Turning it off:** allowed, except where the plan requires it.

**Signing in:**
- After the password, someone with an authenticator is asked for the code (`/login/verify`).
- **Lost phone:** a recovery code, with the password already given, removes the lost authenticator. The person then sets up a new one.
- **Rate limit:** five wrong recovery codes in an hour stops further tries for that person.
- **Google sign-in:** the gate below catches it.

**The gate:** until the session has passed the second step, every business page shows one of two messages instead of the business:
- "Enter your sign-in code", for people with an authenticator.
- "Set up two-step sign-in", for Chairman Owners and Admins without one.

**Who must use it:** Owners and Admins of a business on Chairman (entitlement `security.mfa_required`, on the TOP plan only). Other roles, and other plans, choose for themselves. Someone who has turned it on must always use it.

## Where it is enforced

The screens only explain. The database refuses, so a password alone cannot reach business data through the Data API either.

- **`authz.mfa_ok(business)`** is true unless the person must pass the second step for that business and this session has not (`aal2` in the session token).
  - Someone must pass it when they have a verified authenticator, or the plan requires it for their role.
  - A business with no subscription row requires nothing.
- **What calls it:**
  - The shared membership checks: `authz.has_permission` (and so `authz.require`), `public.is_business_member`, `public.has_business_role` and `management_private.authorize`.
  - These sit behind the row-level security policies and the business functions. The last three are patched from their live definitions, keeping their parameter names.
- **The accounting API:**
  - It reads the `aal` claim from the session token only after Supabase Auth has accepted the token.
  - It passes the claim to the database, and both transaction helpers refuse with 403 when `authz.mfa_ok` is false.
- **Server jobs:**
  - Pay links, Paystack webhooks and the payment check act for a staff member without a browser session. They mark their session `system`.
  - Only the API's own database role can do that. A browser session claiming `system` counts as password only.
  - "Check Paystack now" checks the signed-in person at their own level first.
- **Own memberships:** people always see their own membership rows (`memberships_select_self`), so the app can tell them what to do. The business itself stays hidden until the second step.

## Recovery codes

- **Storage:** `security_private.recovery_code` holds a SHA-256 of user id and code, never the code itself. It is not reachable from the browser.
- **`public.new_recovery_codes()`:**
  - Only works in a session that has just passed the second step, for someone with an authenticator.
  - Replaces any earlier codes and returns ten new ones once.
- **`public.use_recovery_code(code)`:**
  - Marks the code used and deletes the person's authenticators from Supabase Auth (`auth.mfa_factors`).
  - Every try is recorded in `security_private.recovery_attempt`. Five failures in an hour stop further tries.
- **`public.mfa_status(business)`:** tells the app whether the person has an authenticator, whether the plan requires it, the session level, whether the session may use the business, and how many codes are left.

## Database

Migration `20261116090000_two_step_sign_in.sql`:
- **Plan rule:** the plan entitlement `TOP` / `security.mfa_required`.
- **New schema:** `security_private`, holding two tables.
- **New functions:**
  - `authz.mfa_enrolled`, `authz.mfa_required`, `authz.session_level` and `authz.mfa_ok`.
  - `public.mfa_status`, `public.new_recovery_codes` and `public.use_recovery_code`.
- **Changed:** the four membership checks above, and a self-read policy on `public.memberships`.

## Setup (not done by this change)

1. **Confirm the Supabase setting:** in the Supabase dashboard (Authentication, Multi-Factor), confirm authenticator app (TOTP) enrolment and verification are enabled. They are by default.
2. **Apply the migration** (`supabase db push`).
3. **After the push, check production read-only:**
   - `memberships_select_self` exists.
   - The four functions call `authz.mfa_ok`.
   - The test schema cannot show the first two, because it replaces the auth schema and the membership helpers after migrations.

**Before turning it on for Chairman customers:** tell Chairman owners. The first time each Owner or Admin opens the app after the push, they are asked to set it up before they can continue.

## Tests

- **`test_two_step_sign_in_postgres.py` (6):**
  - An authenticator must be used once set up; an unfinished setup changes nothing; others are not affected.
  - The Chairman rule for Owners and Admins only.
  - Only the API role can act as a server job.
  - Recovery codes: hashed, single use, typed loosely, removing the authenticator, five tries an hour per person, unreadable from the browser.
  - The API's check, and the token claim read.
- **The online payments tests now assert every pay-link, webhook and job session is marked `system`.**
- **Jest `two-step-ui` (6):**
  - The gate messages.
  - The code step.
  - Recovery codes, wrong and rate limited.
  - Setting up with a QR code and seeing the codes once.
  - Chairman cannot turn it off; others can.
  - The app gate hiding the business.
