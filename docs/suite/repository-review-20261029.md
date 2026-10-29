# CACU suite execution review - 29 October 2026

## Scope and authority

The user requested applying the Executive Blueprint and Docs 01-20 against CACU_NEW. This is a repository review and incremental implementation, not completion of the multi-release roadmap. All 21 supplied main Markdown exports were inventoried; the index, architecture, gaps, requirements summaries, UX states, migration sequence, release gates and testing guidance were compared with source. Source hashes and section inventories are in [the manifest](source-manifest-20261029.json). Original documents remain untouched.

Documents are design inputs, not shell commands or automatic permission to change live services. Existing user decisions still exclude commercial-rule implementation and email delivery. Doc 01/14/Executive index record new prices and Hybrid eligibility as owner decisions; these are recorded for later review and do not silently override the user's explicit exclusion or remove the demo business's current Hybrid access. Owner/Admin approval of actual opening balances and mappings remains necessary. No platform-wide superuser or tenant bypass is introduced.

Baseline: local commit c62873b, branch fix/hr-status-codes, inspected 29 October. Work is on feat/blueprint-r0-honest-states. Existing staged .vscode/settings.json, modified skills-lock.json and untracked .agents/skills/brag-slim, .claude and brag-output were present before this task and were preserved.

## Export limitations and contradictions

- Doc 03 references a separate Requirements and acceptance tab, Doc 07 a Data dictionary tab, Doc 18 Backlog and Risk register tabs, and Doc 20 a Prompt library tab. These are absent from the supplied files; embedded diagrams are placeholders. Do not claim all 141 requirements or all backlog acceptance criteria were checked or implemented.
- Doc 05 mixes older 14-migration/37-public-table/read-only-HR text with an afternoon update describing 16 migrations/40 public tables/working HR. Its migration sequence still says to apply an attendance policy that its update says is applied. The current repository contains the HR workflow and status migrations and working employee/attendance/payroll consumers. Do not rerun applied migrations or replace HR with old unavailable screens.
- Baseline unit tests actually pass 249 cases in 33 suites, rather than relying on the document's older 216-test count. Historical hosted snapshots and role flags are not a fresh cloud verification. This task uses local source and browser fixtures; no production database, provider configuration, migration history, backups, TLS or PITR state was changed or newly verified.
- Doc 09 proposes transfer clearing, while Doc 14/Executive index still lists transfer clearing among Gate B decisions. This affects money and needs a resolved contract before implementation. Existing transfer posting is preserved.
- A schema metadata snapshot is not a schema-only dump. The missing pre-0001 baseline cannot be reconstructed safely from table names or guessed columns. A reviewed schema export and isolated restore remain necessary.

## Document-to-repository disposition

| Input | Source evidence and disposition |
| --- | --- |
| Executive index | Keep the two-deployment architecture; execute R0 safety before pilot, defer G2-G5 claims. Missing subordinate exports noted above. |
| 01 Product strategy | Existing web/Python architecture retained. No native/mobile rewrite, storefront/community expansion or pricing activation. |
| 02 Business requirements | Existing business selection and membership context retained; DEP-01 runtime/TLS, DEP-02 qualified chart reviewer and DEP-03 consenting pilot businesses remain external. |
| 03 Product requirements | Cross-cutting truth/retry/isolation goals retained. Individual FR acceptance is incomplete without the referenced tab. No invented completion percentage. |
| 04 Software requirements | Existing strict TypeScript, Supabase/Python boundaries retained. Performance, bundle, availability, feature-flag and cross-browser SLOs require measurement; build success does not prove them. |
| 05 Current-state assessment | Confirmed four false settings and five sample analytics screens in source; fixed below. Current HR functionality preserved; source drift corrections above. |
| 06 Solution architecture | Next.js modular application + FastAPI + Supabase retained. PWA outbox, jobs and co-location remain separate work; no new services/dependencies. |
| 07 Database design | Existing accounting and management migrations reviewed. Baseline, cascade restriction, legacy write restrictions, composite keys and search-path hardening need reviewed local/staging migrations. No old migration edited. |
| 08 Tenancy/access | BaseService checks active membership; InventoryService uses management RPCs. DB guard still permits legacy stock writes for non-native tenants; GAP-03 is a DB boundary gap, not evidence that the current InventoryService overwrites stock. Permissions/location redesign remains deferred. |
| 09 Accounting | Existing posting, cutover and report contracts retained. Runtime/TLS, qualified platform chart review, Owner/Admin balances/mappings and hosted reconciliation remain gates. No clearing/tax/costing rule changed. |
| 10 Module specifications | Existing retry-safe inventory/users and HR preserved. Appointments and jobs still use local seed/state. Purchasing, transfer confirmation, allocations and workflow expansions need separately approved contracts. |
| 11 API/integrations | Existing /api/v1, request keys and token forwarding preserved. Cursor pagination, generated contracts, uniform errors and provider webhooks remain follow-ups; no endpoints renamed. |
| 12 UX/UI | Implemented honest unavailable states for SCR-18, SCR-20 and SCR-24 routes below. Existing shared components retained. Brand #5C40FF, navigation redesign, accountant view and accessibility/performance audit remain separate changes. |
| 13 Offline/sync | Offline still unavailable; no service worker, cache, plaintext financial draft or optimistic offline posting introduced. Device identity, encrypted outbox, revoke/tenant-switch handling need an end-to-end design. |
| 14 Subscription/billing | Excluded under prior user instruction. No Paystack calls, new entitlements, charges, seat limits or Hybrid downgrade. Trial/grace/annual/proration decisions remain open. |
| 15 AI/funding | Existing guarded chat remains. The preferred model name is not proof of API availability. Keys, model access, evaluations, context/consent and trusted ledger evidence are required. No funding score or lender sharing fabricated. |
| 16 Security/privacy | Existing RLS and uploads retained. Cascade/direct-write gaps, leaked-password protection, rotation evidence, MFA, CSP/rate limits and privacy review need staged work/owners. No production configuration changed. |
| 17 Infrastructure/DR | Existing GitHub/Vercel setup retained. Separate staging, PITR approval, schema-only baseline, timed restore and operational owners still required. Region, costs and current cloud state not inferred. |
| 18 Roadmap | Start with R0 truth/data-safety, then pilot books. Dates are planning estimates, not delivery promises. Missing BL item definitions prevent claiming a named BL acceptance gate is complete. |
| 19 QA/testing | Added scoped TEST-407 regressions; retained full unit/component suites. This is not a global build scan, full TEST-001/012 Data API matrix, hosted E2E, concurrency benchmark or recovery drill. |
| 20 Agent implementation | Inspect, branch, test, preserve unrelated work, document results. No production writes/deployments. Database/money/access changes receive a separate concrete plan and review. No dependency, CI, auth or role rewrite. |

## Implemented R0 slice: honest settings and analytics

These existing routes now render the shared FeatureUnavailable component instead of fake saves, browser-only budget actions, sample balances or simulated reconciliation:

| Route | Previous false behavior |
| --- | --- |
| /settings/taxes | VAT controls only emitted a saved toast |
| /settings/locale | Language/currency controls only emitted a saved toast |
| /settings/notifications | Delivery toggles only emitted updated toasts |
| /settings/customers | Loyalty controls only emitted an updated toast |
| /analytics/kpi | Hardcoded growth/margin series and statistics |
| /analytics/planning | Hardcoded allocations/spend, non-persistent budget dialog/export |
| /analytics/budget-vs-actual | Hardcoded budget/actual/variance values |
| /analytics/aging-reports | Seed-data receivables/payables presented as balances |
| /analytics/reconciliation | Seed bank/book lines and browser-only matching |

The routes remain valid, state why they are unavailable and offer a real dashboard link. No plan upgrade prompt, network call or new persistence is introduced. Working /analytics/top-selling, /reports, accounting statements, customers, suppliers, stock, HR and user management are unchanged. Statements are not hidden behind a blanket analytics or accounting guard.

These nine screens are only part of TEST-407: local-state appointments/jobs/chart-of-accounts and dashboard placeholders still need separate inspection and fixes. No claim that all R0 gaps or the application are complete.

## Next database safety plan for review

Do not deploy this plan automatically. Preserve business data and credentials outside migrations.

1. Recover a reviewed schema-only baseline (M-00), with functions, grants, policies, constraints and managed prerequisites, and prove it restores into an isolated local/staging target. Existing 0001 and applied migrations stay immutable.
2. Prepare a new M-01 migration to remove direct business deletion and replace catalog-discovered business/financial cascades with RESTRICT. Test owner and non-owner DELETE through real authenticated roles, child history preservation, inactive/native tenants, and legitimate setup/management functions. Do not create a closure workflow by deleting data. Production apply is a human release step.
3. Plan M-02 with all affected consumers together: LedgerService.recordEntry currently writes legacy financial_transactions and InvoiceService has legacy state updates. Revoking grants alone could break workflows. Inventory exact DML consumers and move them behind reviewed atomic RPC/core commands before revoking browser DML. Test viewer denial, non-member denial, tenant mismatch, request-key replay and normal sale/invoice/receipt paths.
4. Plan M-03 around every legitimate stock writer (management adjustment/opening, legacy process_sale_safe, native posting). A guard must distinguish trusted command paths without accepting client-controlled session flags. Test direct Data API stock changes denied and every legitimate audited movement retained; include concurrency and rollback.
5. Add fixed search_path to accounting.immutable_ledger in a new migration, preserving its one-time hash transition and immutability behavior; run real PostgreSQL tests. Leaked-password protection is a separate Supabase Auth setting for the operator.
6. Apply approved migrations only to isolated staging first; compare hosted migration history before any human production release. Do not infer readiness from a green mock test.

## What is required outside this change

- Provide the missing subordinate tab exports for complete FR/backlog traceability. Do not paste secrets or business/customer rows.
- Name an isolated staging target and approve PITR/backup costs if necessary; earlier permission to proceed without a branch did not provide a restorable production baseline.
- Confirm rotation of previously CI-exposed credentials and supply deployment/region evidence through approved read-only access.
- Configure the restricted cacu_runtime login and verified CA path privately, plus the frontend accounting endpoint, then verify the complete stack before activation.
- Name the qualified reviewer of the shared chart/posting fixtures; Owner/Admin approve each business's actual opening date, balances and account mappings.
- Configure the approved OpenAI key/model privately and verify model availability/evaluations. Commercial rules/email remain excluded unless the user explicitly changes that instruction.
- Assign primary/secondary operational owners and record restore/reconciliation evidence before claiming G1/G2.

## Compatibility and rollback

No database migrations, historical data, stock balances, accounting entries, invoices, users, roles or audit rows changed. No dependencies, environment variables, API contracts or deployment configuration changed. Rollback is code-only; returning to prototype pages would restore the false UI behavior and is not recommended. Prefer keeping the unavailable states until real workflows pass acceptance. No database rollback is needed.

## Verification

Final results: `npm run typecheck` passed; `npm run lint` passed with zero errors and 164 remaining warnings in existing code; `npm test -- --runInBand` passed 258 tests in 34 suites; `npm run test:browser` passed all 35 tests; the production build using the private .env passed. `git diff --check` passed for task changes. Initial new tests were corrected to distinguish explanatory text from success messages and to select the exact unavailable heading; no application behavior was weakened to make them pass. Baseline: npm test -- --runInBand passed 249 tests in 33 suites before edits. The nine new unit tests and mobile component tests cover visible unavailable status, dashboard navigation and absence of editable/save/match controls, sample figures and tables. Full browser regression covers prior inventory/users, payment receipts, reports, setup, uploads and AI behavior with explicit action doubles; it is not a hosted production acceptance test. No backend or financial logic changed; backend database suites are not rerun for this source-only UI slice.
