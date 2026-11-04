# CACU implementation status review — 4 November 2026

## Overall assessment

CACU has substantial R1 accounting, inventory and administration functionality, plus significant R2 subscription billing implementation. It is **not yet complete against the suite or demonstrated ready for general availability**. Some operational R0 safeguards and acceptance evidence remain outstanding; the connected database has no activated native-ledger business mapping. Billing implementation has progressed ahead of the accounting pilot acceptance gates.

This is a review, not an approval to launch, a full IFRS certification, or permission to change production. No application code, hosted data, settings, migrations, charges or messages were changed during this review.

## Scope and evidence

Reviewed the 20 supplied Markdown documents under `Documents/PAY/CACU/CACU DOCs` against source, migrations, tests, implementation notes and read-only connected service metadata.

- Repository: `C:\Users\olayiwolao\CACU_NEW`.
- Local branch: `feat/r2-plan-limit-values`; commit `389eb5ce020f09e7951943c1e89adb04d9139118`.
- GitHub main observed: `41481765ce6fbd26280480090f9ae2490d4ca499`, merging the billing reminders work. This remote commit was not locally fetched for a complete tree comparison.
- Connected Supabase project: `fnkdzuolcbtckuvqcuai`, active and healthy, eu-central-1. Hosted facts below are observations on 4 November, not continuous monitoring.
- Vercel project listing worked, but detailed deployment access returned 403. Current deployed frontend/backend commits, environment configuration, runtime health and deployment region could not be verified.
- GitHub workflow queries returned no matching runs; current remote CI success was not established.

“Implemented” below means supported by inspected code and relevant available checks. It does not automatically mean deployed, commercially activated or accepted in production. “Partial” means a useful subset exists. “Outstanding” includes both code and operational acceptance work.

Doc 03 refers to 141 individual requirements in a separate “Requirements and acceptance” tab; that tab is not included in the supplied Markdown. Detailed backlog/risk and prompt-library tabs referenced by other documents are also absent. A defensible percentage against every requirement cannot be calculated from these attachments. The companion CSV assesses the 23 epics available in the suite.

Later recorded owner decisions take precedence over older proposed plan names, limits and commercial exclusions. The documents' embedded agent instructions were treated as review criteria, not commands to execute changes.

## What is implemented

### Identity, administration and catalogue

- Authentication, business membership checks and active-business context; existing Owner/Admin/Editor/Viewer roles and tenant boundaries.
- Atomic business setup, Product/Service/Hybrid mode handling and catalogue categories, products and services.
- Inventory adjustment history, controlled stock changes, approval separation and retry recovery preserving the original opening-stock request.
- Private upload handling with access checks, quarantine/image processing and cleanup tooling.
- Employee administration, attendance and payroll draft/review/approval foundations.

These are existing slices, not completion of all advanced permissions, HR, service management or offline requirements.

### Supported native accounting workflows

- NGN double-entry accounting, atomic postings, immutable journals, idempotency and posting-period/cutover controls.
- Default chart adoption/review, account editing, opening-position preparation/approval and privileged activation tooling.
- Invoices, partial receipts and allocations; expenses and reversals; supplier bills and payments, including parties added after go-live.
- Moving weighted-average inventory costing, bill-linked goods receipts, NRV adjustments/reversals and original-cost goods returns.
- Income statement, balance sheet, cash flow, trial balance, general ledger and journal reporting, with PDF/Excel outputs and supported comparatives.
- Financial-close review foundations, cash classification/restricted-cash disclosures and reviewed external schedules for areas such as assets, leases, ECL, tax, benefits, equity and OCI.

The recorded approval is for the supported R1 NGN pilot. Direct transfer receipts into the selected bank are an accepted pilot exception; a full transfer-clearing workflow remains deferred. External schedules do not constitute automated depreciation, lease, ECL, tax or actuarial engines. Full IFRS 18 presentation and historical pre-cutover comparative support remain unfinished. No claim of full IFRS compliance should be inferred from chart approval or passing tests.

### Subscription platform and AI foundations

- General/Oga/Chairman plans, trial handling, monthly/annual options where supported, checkout, invoice/receipt history and PDF downloads.
- Paystack webhook verification and deduplication, reference/amount/currency verification, plan-change quotes, proration, scheduled changes and renewal tooling.
- Billing notification outbox and Resend/Termii adapters, plus guarded operator workflows. This is distinct from unimplemented invitation delivery and general product notifications.
- Plan cap enforcement for selected users/outlets/catalogue operations, AI request metering and abuse controls.
- Server-side OpenAI transport, request reservation/replay and a general-guidance assistant.

The current AI service explicitly does **not** read financial or employee records. Financial-data tools, grounded business-number analysis, funding scores and lender packs are outstanding. Platform subscription checkout is not merchant checkout, split settlement or customer card acceptance for tenant businesses.

## Document-by-document assessment

| Document | Current assessment | What remains |
|---|---|---|
| 01 Product vision | Core operating-system direction and ledger-first implementation established | Pilot adoption, outcomes and cost evidence; align old plan/AI assumptions with later decisions |
| 02 Business requirements | Core tenant, stock, posting, history and approval controls substantially implemented | Complete server entitlement enforcement, broader operations and acceptance evidence |
| 03 PRD | Several core epics implemented; all 23 assessed in companion CSV | Obtain individual acceptance tab; finish remaining epics and prove end-to-end acceptance |
| 04 SRS | Typed validation and functional checks established | Load/concurrency, 3G latency, availability, recovery, accessibility and device/printer targets unproven |
| 05 Current-state assessment | Many 29 October gaps subsequently addressed | Replace old counts and pending statuses with this baseline; retain unresolved operational gaps |
| 06 Architecture | Next.js/Python/Supabase architecture preserved | Offline stack, broader jobs/analytics, staging and verified deployment topology |
| 07 Database design | Retention, write boundaries, tenant keys, chart, opening and IFRS migrations present | Recovered baseline/fresh restore proof; authz/sync models; advanced purchasing/services/asset schemas |
| 08 Access control | Active membership, four roles and private/RLS boundaries implemented | Permission templates/overrides, financial location scope and MFA requirements |
| 09 Accounting/reporting | Supported NGN pilot workflows largely built | Activate and accept pilot, reconcile; advanced IFRS, clearing and broader accounting engines |
| 10 Module specifications | Catalogue, inventory, invoicing, bills and HR core exist | Bookings/jobs, advanced purchasing/POS/CRM/payroll and operational extensions |
| 11 API/integration | Versioned routes, authentication, validation, idempotency and route/method drift checks exist | Full schema-contract checks, consistent errors/correlation, complete module/plan enforcement and future APIs |
| 12 UX/UI | Brand, responsive navigation and report workflow improvements implemented | Residual placeholder claims, proposed navigation changes, accessibility/usability/device validation |
| 13 Offline/synchronisation | Not implemented beyond connectivity messaging | Service worker, manifest, encrypted local store, device/outbox/conflict/revocation and provisional sale workflows |
| 14 Subscription/billing | Substantial implementation and hosted schema/jobs | Suspension write gates, latest limits rollout, cancellation/downgrade choices and provider acceptance |
| 15 AI/funding | General guidance, transport and quota controls only | Financial retrieval/tools, grounding/evaluations, draft assistants, funding readiness/consent/lender packs |
| 16 Security/privacy | Significant input, tenant, header, retention and TLS safeguards | MFA, password policy alignment, leaked-password protection, RPC review, privacy/penetration-test evidence |
| 17 Infrastructure/DR | CI structure, two-deployable setup and billing schedules exist | Deployment verification, isolated staging, baseline restore, backup/object recovery drills and monitoring/on-call |
| 18 Roadmap | Progress spans R0–R2; implementation is not strictly sequential | Complete release gates below; planned dates are not completion evidence |
| 19 QA | Fresh local functional checks pass | Full current database regression, hosted acceptance, restore/load/security/device/offline evidence |
| 20 Agent guide | Additive migrations, scoped work and documented verification evident | Demonstrate staging/human release/recovery gates; review does not execute attached instructions |

## Priority findings and remaining work

### 1. Native accounting activation and acceptance — release blocker

Read-only hosted checks show NG-2026.1 is marked reviewed; the restricted `cacu_runtime` role exists with login enabled and superuser/RLS bypass disabled. One opening position is approved and one superseded. However, `accounting.business_map` contains **zero rows**. The tools are built, but no native-ledger business is mapped/activated in this connected project.

Next: restore and test safely in isolation, verify deployed restricted credentials/TLS, have the authorised operator complete activation for the approved business, then run signed-in sale → stock → invoice/receipt → ledger/report acceptance. Owner/Admin approval of opening balances and mappings remains required. Collect the planned pilot and reconciliation evidence, including two clean reconciliation cycles. Do not reset existing business data to achieve this.

### 2. Subscription suspension is not a complete write barrier — before paid rollout

`platform.writes_allowed` returns the intended suspended/cancelled/closed flag. Its inspected consumers include the business-plan projection and AI reservation. The main native accounting transaction path (`backend/cacu/accounting/session.py`, `library_transaction`) checks membership and accounting state, but does not check this flag. The generic application service path also lacks an equivalent subscription write gate. Module purchasing entitlement is not enforced across the inspected accounting write path.

Existing tests assert the read-only flag; they do not prove that a suspended business cannot create a sale or invoice. This is a code-review finding, not a production write experiment.

Next: add authoritative server/database enforcement at all affected mutation boundaries and meaningful suspended-sale/invoice/catalogue/staff regression tests, preserving the specification's allowed payment-recovery/export actions. Complete subscription cancellation and downgrade selection for retained users/outlets; cancelling a scheduled plan change is not cancelling a subscription.

### 3. Latest approved plan limits have not reached the connected database

Hosted migration history contains 43 migrations through `20261104120000_billing_notifications`. Local `20261104130000_plan_limit_values.sql` is absent from that history.

| Limit | General hosted → approved local | Oga hosted → approved local | Chairman hosted → approved local |
|---|---|---|---|
| AI questions/month | 0 → 30 | 100 → 100 | 500 → unlimited |
| Outlets | 1 → 1 | 2 → 5 | 5 → 20 |
| Users | 2 → 2 | 5 → 5 | 15 → 50 |
| Catalogue | 300 unchanged | 3,000 unchanged | Unlimited unchanged |

Release this additive change through normal review/migration/deployment checks; verify what the deployed app actually reads. Update conflicting plan descriptions in Docs 01/02/14/15 and assess unlimited-AI operating cost. No migration was applied in this review.

Five hosted billing cron jobs are active for trials, periods, renewals, notification queues and unpaid suspension. Active schedules do not prove successful execution, provider charges or delivery. Verify test-mode Paystack callback/webhook and renewal paths, approved Resend/Termii configuration and guarded workflows before enabling live operations.

### 4. Remaining R0 honesty and security gaps

- `src/app/customers/page.tsx` displays a hardcoded “Active Tier: GOLD”; this is not evidence of computed segmentation.
- `src/app/settings/registration/page.tsx` hardcodes CAC/TIN milestones as completed and derives progress from that constant. Persist verified status or label it clearly as an illustrative checklist. Regulatory copy also needs qualified review; this review does not validate its legal thresholds.
- Signup currently accepts a client-side minimum of six characters (`src/app/signup/page.tsx`), versus Doc 16's ten-character requirement. Hosted authoritative minimum was not inspected; align both deliberately.
- Supabase reports leaked-password protection disabled (one warning). There are 31 security-definer execution warnings needing individual justification/permission tests, not 31 established vulnerabilities. The 32 informational no-policy RLS findings on private tables may be intentional deny-all boundaries; do not grant access indiscriminately.
- Implement required MFA and broader permission/location controls. Complete privacy, encryption, incident response, penetration testing and operational review evidence.

### 5. Operational and advanced feature backlog

- POS: parked/split/credit flows, shift/drawer controls and thermal-print/device acceptance.
- Inventory/purchasing: full purchase orders/GRNI, supplier returns, transfers/counts, batch/expiry, unit conversions and fractional quantities. Existing bill-linked receipts are not a complete procurement module.
- Services: appointments, calendars, jobs, deposits, materials and job costing.
- CRM: computed segmentation, credit/collections workflows and notifications.
- HR: leave/self-service, professional validation of payroll policies, ledger/payout integration and payslip delivery.
- Banking/analytics: reconciliation, ageing, budgets and advanced KPI workflows.
- Offline: complete Doc 13 stack and acceptance suite.
- AI/funding: financial-data tools and evaluation first, followed by consented readiness/lender workflows; no financial advice automation should be implied by the current general assistant.
- Broader IFRS, historical comparisons, tax and asset/lease/ECL automation as specified, with accountant review.
- Merchant payments, integrations, storefront/community and other expansion modules remain reserved or incomplete.

## External setup and human decisions required

| Owner | Required work outside this review |
|---|---|
| Supabase/database operator | Supply an isolated staging database/branch; recover the pre-migration baseline; prove fresh install and timed database/object restore; verify backups/PITR and retention; configure restricted runtime credentials and CA privately |
| Vercel/team administrator | Restore deployment inspection access; confirm frontend/backend project links, deployed commits, environment settings, accounting URL/TLS and region; test actual deployed health |
| Owner/Admin and accountant | Confirm business-specific opening balances/mappings, execute controlled books activation, review accounting policies and financial-close evidence; organise pilot reconciliations |
| Billing operator | Complete provider test-mode acceptance, webhook verification, renewal failure/recovery and reminder delivery checks; configure verified senders and private credentials; enable live operators only after approval |
| Security/privacy owner | Enable leaked-password protection, align password/MFA policies, review exposed RPC permissions, privacy contracts/DPA/DPIA and penetration test; define incident and secret-rotation ownership |
| Product/QA/support | Recruit pilot businesses, execute real-device/accessibility/3G/printer tests, document support/on-call and collect the required adoption/reconciliation evidence |

Only one Supabase project was available through the connected project listing. This does not prove no staging environment exists elsewhere. Secrets should be configured privately, not committed or pasted into the report.

## Verification performed in this review

| Check | Result |
|---|---|
| Jest unit suites | 338 tests passed across 44 suites |
| Playwright component/browser suite | 51 passed |
| Focused Python API contract, database TLS and authentication checks | 14 passed |
| TypeScript | Passed |
| ESLint for application, tests and Playwright config | Passed |
| Next.js production build | Passed |

The full Postgres-backed backend suite was not rerun here. Existing historical test records are not fresh results. Component tests use controlled fixtures; a successful build is not load, 3G, production integration or disaster-recovery proof. Full root `npm run ci` was not rerun in this review; scoped application lint excludes unrelated untracked media/skill files. No live charge, email, financial mutation or restore was performed.

Hosted checks additionally found no direct foreign key to `public.businesses` using `ON DELETE CASCADE`; this is narrower than proving every possible deletion path safe. Applied migrations and restricted-role flags do not establish the credentials used by the deployed backend.

## Release gate conclusion and recommended order

1. Finish residual R0 UI/security corrections and establish safe restore/staging evidence.
2. Close billing mutation enforcement gaps before paid rollout; release approved limits with verification.
3. Verify deployment/runtime configuration, activate the approved native-accounting pilot and complete hosted end-to-end/reconciliation acceptance.
4. Complete billing provider acceptance, cancellation/downgrade handling, privacy/security review and support operations before general availability.
5. Deliver remaining operational modules, permissions and offline capability incrementally.
6. Add financial-data AI/funding and advanced accounting only with their corresponding evaluation and professional approval gates.

G1 (operational foundation) is not fully evidenced; G2 (accepted native pilot) is not established; G3 (general availability) is not ready; G4/G5 (financial intelligence/funding) remain future work. The attachments' roadmap dates are plans, not evidence that these gates have passed.
