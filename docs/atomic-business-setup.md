# Atomic business setup

Business creation now uses `create_business_safe(request_key, details)`. The database locks the authenticated user's row, checks current membership, inserts the business, verifies the existing owner-membership trigger, and records the retry key in one transaction. Missing owner membership rolls back the business. Caller-supplied ownership fields are rejected; identity comes from `auth.uid()` and an existing Auth user.

Retries with the same actor, key and details return the original business before the existing-membership restriction is evaluated. Changed details are rejected; revoked membership cannot retrieve a replay. Different concurrent setup keys for one actor cannot create two businesses. This serializes business setup, not invitation acceptance or all membership changes. It preserves the existing setup restriction for users already registered with a business; it introduces no owned-business quota, paid Hybrid rule or other commercial packaging.

The private request table contains identifiers and a payload fingerprint, not a copy of contact/bank details. It has forced RLS and no browser table grants. The public function is an invoker wrapper around an identity-checked private definer with fixed search paths and explicit authenticated-only execution. Direct browser business INSERT, including column INSERT grants, and TRUNCATE/TRIGGER/REFERENCES privileges are revoked. Existing SELECT/UPDATE/DELETE grants and policies remain subject to their current RLS; this is not a complete policy audit. Request rows cascade away when the corresponding user or business is deleted through authorized administration.

The service consumes the function response instead of performing a second business read. Optional profile/welcome operations are best effort after commit and skipped on replay; delivery is not guaranteed without a future outbox. A selection-cookie failure returns `selectionPending` with the committed business ID. A request UUID is required by the action and service. The setup page freezes the original details and retry UUID in page memory, offers retry and existing-business recovery, and waits for successful selection before uploading a logo. Reloading clears this in-memory attempt; users should select the existing business before restarting setup. No bank details are written to localStorage. Profile refresh failures retain the original request for recovery too.

## Review and setup outside this chat

1. Review the draft and the preceding native-bank-collection draft separately. This setup slice is stacked on that branch; it does not activate native accounting.
2. Recover the complete schema baseline and verify an isolated staging project has `auth.users`, current businesses/memberships, the existing business-type constraints and `businesses_create_owner_membership` trigger. Do not use the conflicting legacy schema document as a baseline.
3. Apply `supabase/migrations/20261011143320_atomic_business_setup.sql` through the migration workflow in staging **before** deploying the matching frontend. Existing clients performing direct business inserts will need this RPC update; coordinate rollout. No hosted migration has been applied by this change.
4. Verify real Auth → setup RPC → owner membership → selection cookie → initial navigation and optional private logo upload. Test an interrupted response, concurrent attempts, existing memberships, revoked access and anonymous requests. Inspect grants/search paths and run database advisors before production review.
5. Approve a production rollout separately. Runtime-role credentials, native activation/opening balances, billing/plan limits, online payout providers and migration retention approvals remain external work.

## Validation

The disposable PostgreSQL fixture matches the inspected source column types and owner trigger. Twelve database tests cover replay, changed payloads, concurrency with same/different keys, ownership rollback, cross-actor keys, invalid details, revoked access and grants. Frontend service/action regressions cover post-commit failure and selection recovery. A mobile Chromium test submits through the real form and verifies all retries reuse the original payload/key after ambiguous creation and selection failure. These fixtures do not prove hosted end-to-end readiness or a full restore.

To run setup database tests, set `CACU_SETUP_TEST_DATABASE_URL` to a separate loopback database whose name ends in `_test`. The fixture destroys its schemas. CI creates `cacu_setup_test` separately from the accounting test database.

Final checks: 142 Python tests (including 12 setup PostgreSQL tests), 52 Jest tests, eight Chromium tests, TypeScript, focused lint and the production build passed. Repository lint passed with 305 existing warnings. Hosted migrations, deployment and commercial rules remain unchanged.
