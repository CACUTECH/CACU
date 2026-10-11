# Legacy financial integrity implementation

Review-only follow-up to blueprint foundations. Commercial rules remain pending review. No hosted migration, tenant activation, or production deployment was performed.

## Behavior

- Sales authorize current owner/admin/editor membership, scope customer/catalogue references to the business, lock products in deterministic order, use current catalogue prices/names, and reject stale quotes, duplicate lines, insufficient stock and unverified card collection. Services do not decrement stock.
- Stable sale request keys are scoped to business and actor and compared against the original payload. Identical retries return the committed sale; changed payloads fail. Source rows, stock changes, income event and replay record commit together.
- Invoice receipts lock the scoped invoice, validate its customer, accept issued unpaid invoices only, and reject amounts above the exact outstanding balance. A partial receipt preserves the unpaid status; only full settlement sets paid.
- Stable receipt references return the existing receipt for identical requests and reject conflicting reuse. Each committed receipt creates one payment-referenced legacy income event. Invoice creation does not book legacy revenue; this retains cash-basis reporting rather than changing recognition policy.
- Lowercase transaction/payment statuses and mandatory payment purpose, reference and customer email follow the inspected live schema. Anonymous customers use an empty email, never an invented address.
- Invoice balance reads return database decimal strings including successful partial receipts. Notification failures after commitment do not report financial transactions as failed.

## Staging rollout and review

Review migration `20261011110551_legacy_financial_integrity.sql` after the foundations access-hardening migration. Apply both to an isolated staging copy matching the real schema, then deploy the matching frontend. Deploying the frontend before the migration will make the new sales/balance RPC calls fail safely. Do not use the incomplete historical schema file as a fresh-install baseline.

The migration creates a private replay table with forced RLS and no browser grants, fixes function search paths, and restricts function execution. It preserves native accounting cutover triggers and never falls back from the Python accounting path. Review role compatibility, database owner privileges and existing payment references before staging application. Existing successful payments contribute to outstanding balances; historical inconsistencies need reconciliation rather than an automatic rewrite.

Manually verify checkout, refresh-after-timeout, partial/full receipts and tenant switching through hosted Auth and Next.js. Existing five-argument sale callers retain tenant/price validation but cannot replay across timeouts; update all callers to the stable-key endpoint before release. Requests without a supplied stable key cannot provide cross-request idempotency. Notifications remain best effort, not a durable outbox.

## Remaining limits

This legacy path accepts manual Cash/Transfer only and catalogue-price sales without tax/discount overrides. Card collection requires a verified gateway workflow. [Native bank collection](native-bank-collection.md) has a prepared follow-up implementation; migration, reviewed bank mappings and staging acceptance remain pending rollout. Invoice creation, direct invoice status changes and direct Data API write policies need separate hardening; this RPC change is not a complete financial write boundary. Balance/list reads remain unpaginated and need bounded reporting work. No commercial pricing, Hybrid eligibility, quotas or permissions bundles were introduced.

## Validation

Real disposable PostgreSQL tests cover tenant/price checks, deterministic stock races, identical-key concurrency, receipt overpayment races, exact partial balances, conflicting retries, viewer restrictions and complete rollback on a late posting failure. Frontend regressions cover stable key transport, exact decimal balance transport and successful financial responses despite notification failure. Local fixtures reproduce relevant schema constraints; they do not establish production release readiness.

Validation results: full Python suite 110 passed (65 existing upstream warnings), then all 26 financial database tests passed after two additional access/replay regressions; 37 Jest tests and TypeScript passed. Focused lint reported no errors and nine existing any-type warnings. Production build results are recorded in the PR.
