# CACU blueprint review and implementation checkpoint

Reviewed 11 October 2026 against main `71ba8d08dc677f69e5bf0d18a3f00b6c6b22db65`, the six supplied [blueprints](blueprint/product-requirements.md), application sources, migrations and read-only live Supabase metadata. These documents are reference specifications: their example SQL and proposed commercial policies are not authorization to activate production features. User decision: keep commercial rules pending review; fix confirmed defects first.

## Changes ready for review

- Billing no longer simulates Paystack success, writes a browser tier, publishes unapproved prices, or displays a fabricated verified beneficiary. The presentation provider ignores localStorage and grants no paid tier. It does not implement authoritative subscription enforcement.
- Staff settings show actual selected-business membership IDs/roles through an authenticated owner/admin service with bounded results and no profile/salary data. No fabricated staff, local invitations, role changes or deletions.
- Offline settings no longer advertise a working cache, a made-up storage quantity, or successful cache deletion. The lending prototype is replaced with an availability notice.
- HR, storefront, integration and community prototypes are hidden from navigation and replaced at server layout boundaries with availability screens. Existing implementations remain in source for later review. Availability screens are product controls, not a replacement for API/RLS authorization.
- Current owner/admin roles are required for salary-bearing HR reads and HR mutations. Attendance explicitly checks that its employee belongs to the selected business. Fine-grained HR bundles and direct Data API column protections remain pending.
- Business refresh clears displayed tenant data, ignores obsolete overlapping responses and remounts tenant content by business/role. The shell derives its business directly from context, removing stale copied profile state. Sign-in recovery routes use the public shell.
- Setup defaults to Product rather than automatically selecting Hybrid. Its existing-membership check uses a bounded list and fails closed on query errors rather than ignoring maybeSingle cardinality failures. Existing Hybrid history/options remain: TOP-only eligibility is a pending commercial/database policy, not falsely claimed as enforced.
- Mobile navigation uses Invoice for Service businesses, exposes Reports, provides current-page semantics and minimum touch targets. Zoom is enabled using Next viewport metadata. Logo primary-dark now has a defined token while existing brand geometry and palette remain.
- Duplicate Jest configuration and obsolete native-driver deployment notes are corrected.

## Read-only database findings

Project `fnkdzuolcbtckuvqcuai` has 54 inspected public/accounting tables with RLS enabled; all 23 accounting tables have forced RLS. This is metadata evidence, not a proof that every policy is correct. Applied migrations: `0001`, `20261011030324`, `20261011085900`, `20261011090000`, `20261011090100`, `20261011090200`.

Private upload buckets cacu-quarantine/cacu-approved are present with 3MiB limits. The three inspected legacy buckets are now private. The runtime role cacu_runtime exists, is not superuser, has no BYPASSRLS, and is **NOLOGIN**. Plans/subscriptions/plan_entitlements/usage_counters/invitations were not present under those names.

Seven legacy SECURITY DEFINER functions still have PUBLIC execution and no fixed search_path. In particular get_business_kpis lacks a membership check and can bypass table RLS. Legacy mutation functions check membership rather than rejecting viewer writes. These findings are confirmed against live function metadata/definitions; no business records or secret values were retrieved.

Prepared [access-hardening migration](../supabase/migrations/20261011102406_harden_legacy_function_access.sql): fix search_path, revoke PUBLIC/anon execution, retain authenticated entrypoints with current membership checks, and deny viewer execution of four financial/stock mutation functions. Existing signatures and current role defaults are preserved. The migration is **not applied to hosted Supabase**. Its upgrade tests use original legacy function definitions on disposable PostgreSQL.

This is targeted access hardening, not a complete rewrite of legacy financial correctness. It preserves legacy source and settlement behavior. Review it on a staging schema before applying; especially verify genuine editor workflows and grant compatibility. Do not activate additional businesses based on this migration alone. Supabase documents the need to restrict function execution and control definer search paths in [database function security](https://supabase.com/docs/guides/database/functions).

## Requirement-by-requirement assessment

Status is source/metadata evidence, not a claim of deployed end-to-end acceptance. PRD numbers map directly to the TECH/DB/FLOW/UX/IMP IDs in the supplied documents.

| PRD | Existing capability / finding | Remaining acceptance work |
|---|---|---|
| 001 Identity | Supabase SSR/Auth and Python bearer verification exist; recovery shell fixed | Hosted redirects, verified registration, expiry/revocation/session tests |
| 002 Businesses | Authorized selection exists; refresh/shell race fixed | Atomic creation baseline, approved ownership policy, offboarding/cache tests |
| 003 Entitlements | Browser-paid authority and simulated billing removed | Approve policy; protected subscriptions/events/usage and verified billing |
| 004 Modes | Product setup default; existing mode preserved | Approved Hybrid eligibility, DB PATCH/RPC guard, transition/downgrade preview |
| 005 Staff | Real owner/admin membership list replaces fake mutations | Seat allocation, expiring hashed invitations, grant ceiling, last-owner races |
| 006 Parties | Customer/supplier services exist | Composite tenant references, archival/normalization, foreign-party acceptance |
| 007 Products | Catalogue reads/writes exist | SKU/price versioning, direct stock write prevention and source snapshots |
| 008 Services | Service catalogue/jobs partially exist | Delivery policy, service no-stock enforcement across UI/API/DB |
| 009 Inventory | Native stock events/locks exist for staged workflows | Legacy foreign SKU/stock paths, purchases, costing approval and reconciliation |
| 010 Sales | Staged native POS path exists | Selected bank account; server quotes, customer/split-credit, direct-call failures |
| 011 Invoices | Staged issue/posting and attachments exist | Full draft/issue immutability, negotiated price policy, fulfillment contracts |
| 012 Credit sale | Native invoice receivables exist; lending UI removed | Customer exposure, cash+credit split and approved terms/limits |
| 013 Repayments | Native allocations/partial receipt tested previously | Multi-invoice customer allocation and explicit advance handling; legacy settlement defect |
| 014 Ageing | Prototype analytics/partial balances | Bounded as-of ageing, no-due-date bucket, AR-tied customer statements |
| 015 Corrections | Staged reversal boundaries | Commercial return/refund approval, original cost, closed-period fixtures |
| 016 Expenses/AP | Operational transactions and native postings partly exist | Paid expense vs bill, supplier AP settlement and selected bank account |
| 017 Ledger | Native migrations applied; restricted role exists | Role login, signed opening reconciliation, supported tenant activation; no dual writers |
| 018 Statements | P&L/balance/cash-flow tabs and reconciliation fixtures exist | Hosted parity, bounded reports, transfer/noncash fixtures, field-level report permission |
| 019 Dashboard | Operational/report services exist | Trusted totals, freshness/error behavior, bounded queries and role projection |
| 020 Offline | Misleading settings replaced | IndexedDB pending drafts, reauthentication, stable retry keys and conflict UI |
| 021 AI insights | Generic Genkit flow exists | Current provider, verified identity/quotas, permission-filtered facts and evaluations |
| 022 AI drafts | Not implemented | User/tenant/payload-bound proposal review; no autonomous posting |
| 023 Attachments | Private buckets/migrations and image validation exist | Hosted auth flow, scheduled orphan cleanup, operator alerting and restore proof |
| 024 Integrations | Notifications/export helpers partly exist; prototypes unavailable | Durable outbox, signed provider events, consent, CSV safety and expiring exports |
| 025 HR | Salary service guarded; prototype UI unavailable | Direct Data API salary projection, approved bundles/payroll and statutory review |
| 026 Operations | Audit/CI/staging tools exist | Complete schema baseline, retention approvals, timed restore, readiness/alerts/load evidence |

## Confirmed blockers requiring the next implementation slices

1. The reviewed follow-up [legacy financial integrity implementation](legacy-financial-integrity.md) addresses sales and receipt defects but is not deployed. The inspected hosted legacy process_sale trusts browser prices/totals and does not consistently scope SKU locks/updates to business. Legacy record_payment_atomic marks invoices paid regardless of outstanding amount and lacks durable receipt replay protection. Legacy invoice creation does not book revenue, so receipt income is the existing cash-basis behavior. Address through a reviewed source/ledger transition and parity suite; do not silently switch active native tenants back to legacy writers.
2. [Native bank collection](native-bank-collection.md) now has a reviewed implementation: Transfer requires an explicit authorized bank account, Cash retains its separate mapping, and ledger/retry/lock fixtures pass. The additive locking migration, actual bank mappings and hosted acceptance remain pending staging review and rollout.
3. Setup's membership cardinality/error handling is fixed, retaining the existing ownership restriction while commercial rules await review. Business creation/membership still needs a recovered baseline and atomic enforcement; do not substitute an unapproved owned-business quota.
4. The standalone fresh-install baseline is still missing. Old docs/supabase_schema.sql has conflicting entity names; 0001 requires preexisting tables/helpers. The targeted migration's function-upgrade fixture is not a full schema restore test.
5. AI server entrypoints and prototype operational settings need auth/quota, truthful persistence and provider checks. Navigation visibility does not secure direct calls. Report/financial list pagination and read-lock contention remain to be measured.

## Decisions for your review

- Review this first foundation change and the access-hardening migration before staging application. Confirm unavailable HR/storefront/integration/community screens are appropriate for the initial release.
- Commercial review remains open: display names/prices, BASE/GROW/TOP packaging, Hybrid eligibility, seat/document/AI quotas, owned-business allowances and seven-day grace. None were activated here.
- Accounting review: Product/Service/Hybrid transitions, selected bank accounts, cost_price versus weighted-average migration, opening debt/stock, tax-free NGN pilot eligibility, return/correction approvals.
- Operations review: privacy/retention, backup RPO/RTO, provider choices, approved staging project and activation owner.

## External setup

Follow [the external setup checklist](external-setup.md). Highest priority: provision the runtime role securely, configure backend secrets and certificate, verify both deployments, and create an isolated staging schema/baseline before applying access or policy migrations. Existing migrations are already applied in the inspected project: do not blindly rerun them.

## Validation

Verified: 86 Python tests passed against disposable PostgreSQL (65 existing upstream warnings), 32 Jest tests passed plus two setup regressions passed, five Chromium component tests passed, and TypeScript passed. Focused lint has no errors and four existing any-type warnings. The Next.js production build passed; /settings/users is rendered dynamically. The build retains pre-existing repository lint warnings. Frontend checks include forged browser tiers, owner/admin-only membership reads, salary read denials, overlapping tenant response rejection and state clearing. PostgreSQL tests cover legacy function upgrades, anonymous execution denial, cross-tenant KPI denial and viewer mutation denial. Existing accounting/upload tests remain required. Component mocks and local database fixtures do not establish hosted Auth→Next→Python→Supabase success or production release readiness.
