# Invitation sign-in continuation

An existing signed-out recipient can open a copied `/join?invitation=UUID` link, choose Sign in and return to that same invitation after password login. Existing Google login carries the validated local destination through CACU's existing PKCE callback. A failed/cancelled callback returns to login with the safe destination retained, without forwarding Auth codes or provider details. Successful callback redirects are private/no-store.

The same local-path validator protects password navigation and callback redirects: external/protocol-relative URLs, backslashes, control characters, nested encoded slash/backslash/control variants and normalized paths that become protocol-relative are rejected. Ordinary dashboard sign-in still returns to `/`; default Google login keeps its existing callback URL unchanged. The recipient must still explicitly accept the invitation, and the existing database verifies the invited email, expiry, tenant and role constraints. This change grants no membership by redirect alone.

Email delivery remains unimplemented by the user's explicit choice. No email adapter, SMTP call, account-provisioning workflow or live Auth test was added. New recipients who need to sign up continue to use the existing sign-up/email verification process and reopen the original invitation afterward; this increment covers existing password/Google sign-in.

## Setup and compatibility

This branch builds on draft PR #17. No additional database migration, package upgrade or environment variable is needed. Deploy after the reviewed parent implementation. Before testing invitation-specific Google login, confirm the trusted CACU callback with its `next` query is accepted by the project's Supabase redirect allowlist; do not allow untrusted hosts or replace existing callback entries. Default Google sign-in is unchanged. Supabase documents [redirect allowlists](https://supabase.com/docs/guides/auth/redirect-urls) and [cookie-based SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

Reviewed current Supabase Auth guidance and changelog. The self-hosted Auth URL change does not apply to the existing hosted Supabase integration. No provider configuration was changed in this chat. All Auth exchanges in regression tests use mocks, not live accounts.

Rollback this increment by reverting its application commit. It changes no business records, memberships, stock, Auth accounts or database schema. Keep the parent inventory/user-management authorization safeguards when rolling back. Callback security should preferably remain in place even if invitation continuation is withdrawn.

## Verification

Regression coverage includes local/unsafe redirect variants, successful and failed PKCE exchanges, password invitation continuation, Google callback construction and rejection of external destinations. Final check results are recorded after completion. Existing frontend inventory, accounting, user-management and upload regressions are included in the Jest run; backend/SQL paths are unchanged.

Final checks: 123 Jest tests and 15 browser tests passed; TypeScript and the production build using the private `.env` passed. Lint passed with 0 errors and 241 existing warnings. No new component warnings, migrations or dependency changes. The initial new sign-in test hit the existing icon ESM test environment limitation; decorative icons were mocked locally in that test without changing Jest configuration or packages.
