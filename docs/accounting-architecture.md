# Accounting architecture decision (2026-10-11)

Status: accepted direction; Phase 1 implementation in progress, no production cutover.
Baseline: CACUTECH/CACU main cef3c01813033824644521bbe2d2bea99f4da228; checkout initially clean and identical.

Keep Next.js App Router at repository root, existing URLs, UI tokens, providers and Genkit. Add FastAPI under backend/ as a separate deployment. Reuse businesses/memberships and existing accounts/journal_entries/journal_lines after schema verification. No parallel company model or replacement frontend.

## Evidence and keep/change/remove matrix

| Files | Observed behavior | Decision / gap |
| --- | --- | --- |
| src/services/base-service.ts | first membership selected with limit(1) | change: require explicit active selection for multiple memberships |
| src/components/business-provider.tsx | maybeSingle membership | change: list memberships and select an authorized business |
| src/services/customer-service.ts, invoice-service.ts | Supabase calls and server actions exist | keep UI; persistence exists at source level, live behavior unverified |
| src/services/payment-service.ts; 0001_init.sql | payment marks Paid and inserts Income again | change: invoice lock, allocations, accrual journal; no revenue on receipt |
| src/services/sales-service.ts; 0001_init.sql | supplied totals/prices, unscoped SKU locks | change: tenant references, aggregate SKU quantities, authoritative prices |
| src/services/ledger-service.ts | single-entry insert then best-effort audit | replace only after atomic journal parity tests |
| src/app/accounting/journal-entries/page.tsx | handleSave shows success without persistence | prototype; prevent false successful posting until real API enabled |
| src/app/accounting/trial-balance/page.tsx | hardcoded values plus demo suspense | remove fabricated report; enable real ledger query after schema validation |
| src/app/accounting/chart-of-accounts/page.tsx | local account data | migrate to real accounts |
| src/app/hr/employees/page.tsx, hr/attendance/page.tsx | browser Supabase reads | preserve; audit active tenant filters |
| appointments, jobs, storefront, payroll, credit pages | state/sample workflows require further review | preserve routes; no provider-backed or statutory claims supported yet |
| docs/backend.json, docs/supabase_schema.sql | Firestore vocabulary / business_members and sales conflict with services | historical references, not canonical deployment schema |
| .github/workflows/ci.yml | existing npm lint/typecheck/test/build job | retain; remove production secrets from PR job; add Python tests |
| next.config.ts | ignoreBuildErrors and ignoreDuringBuilds enabled | remove after underlying checks repaired |
| README, PRODUCTION_CHECKLIST | unsupported security/scale/compliance assertions | replace with measured release gates |

Source vulnerabilities are confirmed in tracked code; exploitability, live grants, exposed schemas and production migration state remain unknown. Supabase metadata listing succeeds, SQL and migration inspection fail with 28P01. Vercel lists cacu but project inspection and same-team CLI fail authorization. No production data or configuration changed.

## Authorization and write path

Next.js validates getUser(), reads the selected business cookie, and queries current membership on every request. getSession() supplies the access token only after getUser validation; Python independently calls Supabase Auth /auth/v1/user and queries memberships inside its own transaction. Client roles/user metadata never authorize accounting. Selection is a hint, never a grant.

Python uses a restricted non-owner, non-BYPASSRLS role. Use TLS verify-full and a transaction pooler, disable prepared statements, use no persistent client pool. Set request.jwt.claims and active business transaction-locally before any tenant queries. Reject invalid runtime roles. A posting repository must perform source document, journal lines, audit and idempotency in one transaction. No implemented endpoint may report posting success until this boundary exists and is tested.

Browser-to-Next Server Actions retain Next's origin checks. Python is bearer-only, accepts no auth cookies, and exposes no credentialed CORS by default. Token refresh remains Supabase SSR's responsibility. Invalid/expired bearer tokens fail closed.

## Cutover order

1. Capture reviewed schema-only baseline; test fresh/upgrade installs and all privileged functions directly.
2. Add journal posting constraints, period locks, composite tenant foreign keys, durable keys and immutable posted entries.
3. Migrate customer -> invoice issue -> payment allocation -> journal -> reports with parity and rollback tests.
4. Disable replaced legacy writes and browser financial DML in the same tested release. Never dual-write.
5. Extend stock/weighted-average costing and purchases only after the first slice passes.

No legacy financial backfill until reviewed account mappings and source totals reconcile. Missing offsets become exceptions, never suspense plugs. Set cutover date only with reconciled trial balance, AR/AP and stock control accounts.