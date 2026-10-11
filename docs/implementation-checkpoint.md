# Implementation checkpoint — 2026-10-11 (Africa/Lagos)

## Scope and provenance

Repository origin https://github.com/CACUTECH/CACU.git. Started clean at cef3c01813033824644521bbe2d2bea99f4da228, exactly the requested main baseline. Feature branch feat/python-accounting-core. No unrelated changes existed. Original npm versions and lockfile retained; no framework upgrade. No production writes or migrations performed.

This is an incomplete Phase 1 checkpoint. Phases 2–4 have not started. No claim of production readiness or successful accounting posting.

## Delivered

- Evidence-based file audit/keep-change matrix and architecture decision before implementation.
- FastAPI health and authenticated journal-validation endpoint; Pydantic decimal-string/finite/precision/line/balance validation, payload limit and sanitized errors.
- Independent Supabase Auth verification; per-transaction membership/role lookup; restricted runtime role/ownership checks, TLS verification, no client pool and disabled prepared statements. Database-dependent behavior remains unverified.
- OpenAPI plus generated TypeScript contract and server-only token-forwarding adapter. Adapter is not wired into existing financial writes; no posting endpoint exists.
- Explicit active-business cookie, current membership checks, selection prompt and switcher. Switching reloads the workspace so previously loaded state is discarded. BaseService no longer selects the first membership for multi-business users.
- Active business filters on customer/catalog/POS/inventory/invoice/transaction/supplier/HR/notification reads; embedded customer/employee relations scoped too. Browser filtering does not replace database tenant constraints.
- Journal prototype no longer reports a successful save. Sample chart/trial-balance balances and suspense row removed; unimplemented report/account actions disabled. Routes and design retained.
- Existing CI retained and extended with Python tests; production credentials removed from ordinary PR job; Next type/lint build bypasses removed.
- Setup/env templates, deployment/release/operations docs corrected; historical SQL flagged unsafe as a deployment baseline.

## Observed tests

Baseline npm ci succeeds. npm run lint: success with 331 warnings. Independent npm run typecheck: success. npm test -- --runInBand: four suites/eight tests pass. npm run build: success, with Genkit/OpenTelemetry optional exporter and missing-config warnings.

Implementation: independent typecheck passes; six Jest suites/14 tests pass; clean Python 3.12 environment passes 24 tests, including Hypothesis properties, auth rejection and payload limits. Updated lint/build pass with checks enabled; warnings remain. Python pip-audit reports no known vulnerabilities in requirements.lock after replacing the newly introduced vulnerable Starlette/pytest versions. TestClient has an httpx deprecation warning.

Existing npm audit reports 116 vulnerabilities (63 moderate, 52 high, one critical). Critical transitive handlebars advisory has a reported patch; broad npm audit fix was not run. Review full dependency chains/reachability and targeted fixes before release. No database/browser/live exploitability claim follows from these unit tests.

## External access and environment limits

Supabase lists CACU Tech (fnkdzuolcbtckuvqcuai), but execute_sql and list_migrations fail 28P01 password authentication for postgres. Live schema, policies, grants, storage, migration history and canonical journal structures are not verified.

Vercel lists cacu/prj_dGga8i001xXAcRdLmJB8otPwPQFF, but get_project for team_1wa2SWkcHaqsq59sLpjnQI1x fails 403. Same-team vercel CLI inspection says account access denied. Repository/deployment/domain relationship remains unconfirmed. No previews deployed; www.usecacu.com unchanged.

No Docker, Postgres or Supabase CLI found on PATH. No supplied isolated test-database credentials. Real SQL/RLS/atomicity/concurrency, fresh-install/upgrade and browser acceptance cases were not executed. The deterministic NGN fixture has not been run through a persistent accounting system and has no delivered fixture output.

## Next exact vertical slice

1. Recover reviewed schema-only baseline, especially accounts/journal_entries/journal_lines, policies/privileges/helpers/status enums; provision a disposable test database. Reconcile obsolete documentation to one canonical path without touching production.
2. Complete Phase 1 RPC repairs: process_sale/create_invoice_atomic/record_payment_atomic tenant references, roles, numeric validation, deterministic aggregate SKU locks, service stock exclusion, authoritative totals, invoice locking/partial allocations and no accrual revenue on receipt. Repair get_business_kpis authorization, all public function grants/search paths, and narrow business-assets replacement policy.
3. Enforce composite business-owned references, posting-only financial DML, balanced immutable journals, closed periods, durable idempotency and atomic audit at the real database boundary. Runtime policies must consume transaction-local identity; do not assume a connection inherits Auth claims. Account validation currently expects accounts.is_active, an unverified proposed contract; reconcile it before activation.
4. Run direct hostile-ID/viewer/revoked-membership/RPC tests, failure rollback and concurrency tests on actual SQL. Validate fresh and representative upgrade paths. Do not migrate a financial workflow until these pass.
5. Then migrate the customer -> invoice issue -> partial receipt -> journal -> report slice through Python, run the NGN fixture, and retire each replaced legacy write path only after parity. Legacy financial_transactions writes still exist and remain unapproved for production release.
6. Confirm authorized preview projects and separate test DB; verify UI/API/database flow before any production cutover. Remaining wider modules require detailed classification and honest prototype treatment.

A draft PR is appropriate for this checkpoint; do not merge or release it as complete Phase 1.