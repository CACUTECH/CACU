> Blueprint v1 · 11 October 2026 · Repository baseline `71ba8d08dc677f69e5bf0d18a3f00b6c6b22db65`. Source audit and proposed target design; no production activation is implied.

# Phased implementation roadmap and delivery plan

## Starting point and delivery policy

This plan builds on the pinned audited repository; it does not assume starting from an empty app. Existing Python ledger/report/upload safeguards stay in place, while their deployment, complete source schema and broader product policy are validated. MVP ends with enabled, reconciled flows through G and K; H/I/J are staged enhancements. Hybrid enforcement is a foundation requirement in B; expanded Hybrid UX comes only after core product/service correctness. No application code, dependency installation or production migration is part of this documentation deliverable.

Critical path: A baseline/identity → B memberships/entitlements/mode → C canonical ledger → D sources/catalogue → E sale/invoice/expense → F debt/repayment/correction → G reports/notifications → K release. UI design, isolated QA fixtures and catalogue form work can proceed after B contracts settle; they cannot activate financial writes before C. H and I can be developed independently after stable command/fact contracts. Every phase must update traceability when scope changes.

Estimates below are engineer-days of focused work, excluding stakeholder waits, historical reconciliation size, external access and statutory review. Roles are needed capabilities, not promises of staffing. A small team of 2–3 engineers plus shared design/QA/accounting support should reassess estimates after A. Do not add durations as a guaranteed launch date or execute phases in parallel without dependency checks.

## Delivery phases

### Phase A — Repository and schema foundations

- **Scope / objectives:** MVP; deliver PRD-001, PRD-002, PRD-023, PRD-026 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** None.
- **Affected modules/files:** docs/schema-reconciliation.md; supabase/migrations; .github/workflows/ci.yml; package/uv locks; src/middleware.ts. Proposed modules are created only when implementing this phase.
- **Build order:** Recover schema-only baseline and migration history; reconcile old docs; map prototypes; inspect dependency reachability; verify Auth/session context and upload policies; create disposable fresh/upgrade test databases.
- **Database / migrations:** Baseline schema/fixtures only; no production migration; narrow grants planned against actual policies.
- **API / frontend:** Keep working UI; hide false lender/staff/billing/offline success; sanitized error/readiness status; scoped callback/environment config.
- **Tests / acceptance:** Forged session, cross-tenant reads, expired Auth, upload spoofing/parent ownership, full restore fixture; AT-001/002/023/026. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** No production credentials in PR jobs; privileged storage key confined; review public SECURITY DEFINER functions.
- **Definition of done:** Repeatable schema baseline, audited source inventory and isolated CI fixtures; exact dependency audit report; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Missing baseline/deployment access; retain current production, no native activation; document drift blockers.
- **Estimated effort / roles:** 4–7 days; Tech lead, backend, DevOps.

### Phase B — Memberships, subscription policy and business modes

- **Scope / objectives:** MVP; deliver PRD-003, PRD-004, PRD-005 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** A.
- **Affected modules/files:** src/components/subscription-guard.tsx; settings/billing/users; setup; business-service.ts; backend/cacu/policies (proposed). Proposed modules are created only when implementing this phase.
- **Build order:** Approve codes/packaging placeholders; central policy resolver; subscriptions/events/counters; atomic seat/invite flow; role bundles; mode impact preview and DB guards; verified billing adapter behind test credentials.
- **Database / migrations:** Versioned plans/entitlements/subscriptions/events/usage; invitations and permission metadata; protected business mode columns/triggers.
- **API / frontend:** /entitlements, invitations, billing/status, mode-preview/apply; replace localStorage tier authority and setup Hybrid default.
- **Tests / acceptance:** AT-003/004/005, spoofed plan, direct Data API Hybrid mutation, last seat race, last owner, revoked invite/user, expiry and over-limit preservation. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Server policy on every protected write, DB bypass tests, webhook signature/replay validation.
- **Definition of done:** TOP-only Hybrid cannot be bypassed; staff roles/invites persist; no simulated upgrade state; downgrade allows collection/corrections; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Unapproved prices/provider and grant ceiling; feature flag policy for pilot without weakening restrictions; preserve subscriptions/history.
- **Estimated effort / roles:** 7–12 days; Backend, frontend, product.

### Phase C — Canonical accounting and staged cutover

- **Scope / objectives:** MVP; deliver PRD-017, PRD-018 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** A + B policy.
- **Affected modules/files:** backend/cacu/accounting; tools/provision_entity; native schema/boundary/cutover migrations; accounting-client.ts. Proposed modules are created only when implementing this phase.
- **Build order:** Retain pinned native engine; fix Cash/Transfer account mapping; granular posting permissions; limits/rounding; recover/import reconciled history; period and map validation; compare all controls.
- **Database / migrations:** Reviewed additive native migrations on isolated branch; mappings/staged evidence; no production activation until gate.
- **API / frontend:** Existing /journals,/postings,/reports endpoints plus errors/pagination; account/report UI connects only to active canonical ledger.
- **Tests / acceptance:** AT-017/018; balance/period/immutability/RLS, atomic rollback, replay conflict, cash transfer/noncash asset/depreciation, as-of reports. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Runtime non-owner/NOBYPASSRLS, transaction-local context, restricted map/activation grants; close legacy bypass for active tenants.
- **Definition of done:** Reconciled NGN tax-free staged fixture and import rehearsal; native ledger sole active writer; financial exports match; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Historical gaps, upstream behavior, tax/gateway needs; no automatic activation; never rollback to legacy writers after native writes.
- **Estimated effort / roles:** 8–15 days plus historical reconciliation; Accountant, backend, QA.

### Phase D — Parties, catalogues, receiving and service delivery

- **Scope / objectives:** MVP; deliver PRD-006, PRD-007, PRD-008, PRD-009 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** B + C accounting.
- **Affected modules/files:** customer/supplier/inventory services; catalog/inventory/jobs routes; proposed purchases/deliveries backend. Proposed modules are created only when implementing this phase.
- **Build order:** Party tenant constraints/archive; product/service field separation; one location receiving; stock movement reasons; costing decision and original-cost snapshots; service delivery record.
- **Database / migrations:** Composite ownership keys; purchase/source fields and receiving movements; catalogue row versions; service delivery extension.
- **API / frontend:** /catalog,/customers,/suppliers,/purchases,/inventory/adjustments,/services/deliveries; reusable catalog/forms.
- **Tests / acceptance:** AT-006/007/008/009; foreign SKU/party, simultaneous last unit, service no-stock, atomic purchase rollback, archival history. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** No direct stock overwrite or arbitrary tenant reassignment; inventory permission distinct from finance.
- **Definition of done:** Received stock and valuation reconcile; service workflows stock-free; catalogue usable at 360px; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Unresolved costing/partial units; keep integer-unit/one-location MVP; reverse incorrect movement rather than delete.
- **Estimated effort / roles:** 7–12 days; Frontend, backend, inventory SME.

### Phase E — Sales, invoices, expense/payment vertical slices

- **Scope / objectives:** MVP; deliver PRD-010, PRD-011, PRD-016 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** C + D.
- **Affected modules/files:** pos/invoices/transactions routes; sales/invoice/payment services; accounting/workflows.py. Proposed modules are created only when implementing this phase.
- **Build order:** Server quote/price snapshots; stable UI retry key; draft→issue; cash/bank account selection; service/product mixed eligibility; expenses/AP; event outbox.
- **Database / migrations:** Source snapshots/status/date/treasury fields, composite FKs; reuse native source maps and replay records.
- **API / frontend:** Extend sales/invoices/receipts compatibly; proposed expenses/supplier-payments; exact confirmation and committed receipts.
- **Tests / acceptance:** AT-010/011/016; stale price, partial payment, issue twice, transfer account, expense paid/unpaid, audit failure, no mock success. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Source DML only through command; discounts/payment account privileges; card unavailable until verified gateway.
- **Definition of done:** Auth→UI→API→DB sale/invoice/receipt/expense tested in staging; control totals and stock match; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Tax/gateway restrictions; pilot eligible businesses only; keep old history, correct through documents.
- **Estimated effort / roles:** 8–13 days; Frontend, backend, accountant, QA.

### Phase F — Customer credit, repayment and corrections

- **Scope / objectives:** MVP; deliver PRD-012, PRD-013, PRD-014, PRD-015 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** E.
- **Affected modules/files:** proposed /receivables and customer-detail routes; payment-service.ts; native assignments/posting; analytics ageing. Proposed modules are created only when implementing this phase.
- **Build order:** Credit eligibility/exposure; cash+credit split; opening debt evidence; multi-invoice allocations; as-of ageing/statements; follow-up; bounded returns/credit/refund/writeoff approval.
- **Database / migrations:** Terms/limit metadata, collection followups, correction source links; no mutable debt or duplicate native allocations.
- **API / frontend:** /sales split-credit,/receipts allocations,/receivables/ageing,/statement,/credit-notes,/refunds; redirect prototype /credit.
- **Tests / acceptance:** AT-012/013/014/015; 100000 split fixture, concurrent allocation, overpayment advance, ageing as-of, return original cost, restricted downgrade collection. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Customer lock and deterministic invoice locks; approval/closed period controls; no lending interest/scoring.
- **Definition of done:** AR equals invoice subledger and statements; repayments never duplicate revenue; customer can settle debt even when over creation quota; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Return condition/history and reminder consent; corrections forward only, no erased debt/source.
- **Estimated effort / roles:** 8–12 days; Backend, frontend, credit SME, QA.

### Phase G — Dashboards, reporting, notifications and exports

- **Scope / objectives:** MVP basic reports, P1 automation; deliver PRD-019, PRD-024 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** C + E + F.
- **Affected modules/files:** report-service.ts; reports/analytics routes; notifications; proposed outbox/worker. Proposed modules are created only when implementing this phase.
- **Build order:** Canonical dashboard metrics; real week grouping/P&L categories; shared ageing source; role-filtered projections; reliable event outbox; snapshot exports.
- **Database / migrations:** Reporting indexes/views security_invoker; outbox/attempts if equivalent table absent.
- **API / frontend:** /reports,/exports,status; mode-specific dashboard, source drilldown, as-of labels.
- **Tests / acceptance:** AT-019/024; metric-to-ledger parity, no-data vs failed, restricted column/API, CSV formula injection, duplicate delivery. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Tenant+role cache keys, private expiring export objects, consent-aware recipients.
- **Definition of done:** Readable reconciling dashboard/reports and permitted exports; notifications failure cannot invalidate financial commit; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Worker/provider availability and cost; pause jobs, preserve outbox for replay.
- **Estimated effort / roles:** 5–9 days; Frontend, backend, QA.

### Phase H — Offline drafts and synchronization

- **Scope / objectives:** P1; deliver PRD-020 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** B + E + F.
- **Affected modules/files:** settings/offline; proposed service-worker/IndexedDB/sync modules. Proposed modules are created only when implementing this phase.
- **Build order:** Cache shell; actual storage state; tenant/user operation namespace; recovery; dependency ordering; stable command replay; manual conflicts; signout review.
- **Database / migrations:** Nonfinancial sync metadata only where needed; reuse native replay keys for finance.
- **API / frontend:** /sync/operations,/operations/{key}; pending/conflict/status UI; offline capture without final receipt.
- **Tests / acceptance:** AT-020; restart, lost acknowledgement, eviction, permission/plan/stock/price/period change, tenant switch, no-background-sync support. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** No stored bearer/service key; shared-device purge; pending permissions not authority.
- **Definition of done:** Captured surviving drafts recover and synchronize once; conflicts visible, no silent financial merge; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Browser eviction/device loss; disclose unsynced limits; online flow remains independently usable.
- **Estimated effort / roles:** 8–12 days; Frontend, backend, QA.

### Phase I — Authorized AI insights and reviewed drafts

- **Scope / objectives:** P1 insights; P2 drafts; deliver PRD-021, PRD-022 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** B + G; H optional for draft capture.
- **Affected modules/files:** src/ai/genkit.ts; business-insights-flow.ts; ai-assistant.tsx; proposed ai facts/usage modules. Proposed modules are created only when implementing this phase.
- **Build order:** Provider/model health checks; adapter/prompt version; typed authorized facts; privacy settings; schema validation; quota/token/cost reservation; injection evaluations; confirm-bound draft workflow.
- **Database / migrations:** Minimal redacted conversations/usage/tool audits; policy retention; no global mixed-tenant vector index.
- **API / frontend:** /ai/insights,/ai/drafts,/confirm; facts vs interpretation and quota/error panel.
- **Tests / acceptance:** AT-021/022; cross-tenant/injection, missing facts, simultaneous budget exhaustion, provider timeout, changed confirmation, revoked permission. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** No arbitrary SQL/write tools; explicit user confirmation; provider consent, minimal PII and secrets.
- **Definition of done:** Evaluations passed, metrics trusted, provider expense bounded; AI failure does not block ordinary transactions; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Provider deprecation/hallucination; disable provider features without changing core financial workflows.
- **Estimated effort / roles:** 6–10 days insights + 5–8 days drafts; AI engineer, backend, frontend, QA.

### Phase J — Expanded modes, HR, tax/gateway and integrations

- **Scope / objectives:** P2; deliver PRD-025 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** B + C + F + I as needed.
- **Affected modules/files:** HR modules; taxes/banks; gateway adapters; integration routes; advanced inventory. Proposed modules are created only when implementing this phase.
- **Build order:** Hybrid eligibility already delivered B; expand mixed jobs/multi-location only after parity. Current tax/HR policy review, gateway signature/settlement/refund reconciliation, payroll permissions, scoped integration API.
- **Database / migrations:** Reviewed tax/effective-date/FX if explicitly approved; provider event dedup; HR salary projections; locations; approved plan entitlements.
- **API / frontend:** Approved HR/gateway/integration endpoints, no fake “verified beneficiary”, no lending launch.
- **Tests / acceptance:** AT-025 plus expanded AT-004/009/010/015/018/024; provider sandbox duplicates/refunds and tax fixtures. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** Statutory policy/review and current provider docs prerequisite; prohibit raw cards and cross-tenant credentials.
- **Definition of done:** Expanded capability individually accepted; taxable/card businesses only activated after respective gates; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Unapproved jurisdiction/provider/FX policy; defer rather than silently assume rates or activate unsupported tenants.
- **Estimated effort / roles:** Discovery-based; 15–30 days preliminary; Product, accountant/legal, backend, frontend.

### Phase K — Security, performance, pilot and production release

- **Scope / objectives:** Release gate for all phases; deliver PRD-026 and their TECH/FLOW/UX/DB/IMP contracts.
- **Prerequisites:** A–G for MVP; P1/P2 enabled only after own gates.
- **Affected modules/files:** CI; release/operations docs; schema and runtime policies; deployed preview. Proposed modules are created only when implementing this phase.
- **Build order:** Full-flow auth and permission matrix; adversarial Data API tests; load/cost tests; backup restore; production plan fit; observability/runbooks; limited reconciled pilot.
- **Database / migrations:** Inspect final grants/RLS/default privileges/triggers; staging upgrades/restore proof; no unreviewed production DDL.
- **API / frontend:** Readiness, error IDs, support audit, feature flags; preview rooted correctly and isolated from production.
- **Tests / acceptance:** All AT-001..026 in enabled scope; restore controls, 50 RPS/p95 targets, failure recovery, dependency scan, accessibility. Expected results come from PRD acceptance criteria; verify real DB mutations and failure rollback, not implementation-mirroring mocks alone.
- **Security:** No secrets in outputs/jobs; time-bound support; privacy retention approved; tenant activation separate reviewed release action.
- **Definition of done:** Signed ledger reconciliation, true full stack, capacity and recovery evidence; feature-specific gates met; review migration plan, measured evidence, error recovery and documentation updates.
- **Risk / rollback:** Vercel access failure/dependency build/cost; keep production unchanged until evidence; app rollback only with schema compatibility.
- **Estimated effort / roles:** 5–10 days plus 2–4 week pilot; Tech lead, DevOps, QA, accountant, support.

## Shared traceability matrix

Stable IDs are requirements, not standalone tickets. Below maps product → screens → API/model/control → tests → implementation. FLOW group expands to per-route screen IDs in application-flows.md. TECH/DB contain detailed contracts; implementation must add exact test paths/results and migration IDs as those are created.

| Product / delivery | Screen / UX | API / entities / security | Test and phase |
|---|---|---|---|
| PRD-001 / IMP-001 | FLOW-001 / UX-001 | TECH-001: Auth/session / profiles / verified identity; DB-001 | AT-001; Phase A |
| PRD-002 / IMP-002 | FLOW-002 / UX-002 | TECH-002: /businesses, selection / businesses,memberships / current membership; DB-002 | AT-002; Phase A |
| PRD-003 / IMP-003 | FLOW-003 / UX-003 | TECH-003: /entitlements,/billing / plans,subscriptions,usage / server policy and DB protected state; DB-003 | AT-003; Phase B |
| PRD-004 / IMP-004 | FLOW-004 / UX-004 | TECH-004: /mode-changes / businesses,subscriptions / TOP + owner + DB guard; DB-004 | AT-004; Phase B |
| PRD-005 / IMP-005 | FLOW-005 / UX-005 | TECH-005: /invitations,/memberships / invitations,permissions / seat lock, grant ceiling; DB-005 | AT-005; Phase B |
| PRD-006 / IMP-006 | FLOW-006 / UX-006 | TECH-006: /customers,/suppliers / parties / tenant composite refs; DB-006 | AT-006; Phase D |
| PRD-007 / IMP-007 | FLOW-007 / UX-007 | TECH-007: /catalog / catalog_items / mode and catalogue permission; DB-007 | AT-007; Phase D |
| PRD-008 / IMP-008 | FLOW-008 / UX-008 | TECH-008: /services/deliveries / jobs / Service/Hybrid, no stock; DB-008 | AT-008; Phase D |
| PRD-009 / IMP-009 | FLOW-009 / UX-009 | TECH-009: /purchases,/inventory/adjustments / stock_event / quantity-cost locks; DB-009 | AT-009; Phase D |
| PRD-010 / IMP-010 | FLOW-010 / UX-010 | TECH-010: /sales / transactions,items / quote, mode, atomic posting; DB-010 | AT-010; Phase E |
| PRD-011 / IMP-011 | FLOW-011 / UX-011 | TECH-011: /invoices,/receipts / invoice,document_map / issue immutability; DB-011 | AT-011; Phase E |
| PRD-012 / IMP-012 | FLOW-012 / UX-012 | TECH-012: /sales split-credit / customer,AR / exposure and customer ownership; DB-012 | AT-012; Phase F |
| PRD-013 / IMP-013 | FLOW-013 / UX-013 | TECH-013: /receipts / payment,native assignment / bounded locked allocations; DB-013 | AT-013; Phase F |
| PRD-014 / IMP-014 | FLOW-014 / UX-014 | TECH-014: /receivables/ageing,/statement / invoice,assignment / as-of tenant query; DB-014 | AT-014; Phase F |
| PRD-015 / IMP-015 | FLOW-015 / UX-015 | TECH-015: /credit-notes,/refunds,/reversals / source,reversal_map / bounded original quantity/approval; DB-015 | AT-015; Phase F |
| PRD-016 / IMP-016 | FLOW-016 / UX-016 | TECH-016: /expenses,/supplier-payments / bills,native AP / selected account and atomic audit; DB-016 | AT-016; Phase E |
| PRD-017 / IMP-017 | FLOW-017 / UX-017 | TECH-017: /journals,/postings / native ledger,maps,periods / balance,immutability,RLS; DB-017 | AT-017; Phase C |
| PRD-018 / IMP-018 | FLOW-018 / UX-018 | TECH-018: /reports/summary,/cash-flow / ledger,maps / reconciliation and report permission; DB-018 | AT-018; Phase C |
| PRD-019 / IMP-019 | FLOW-019 / UX-019 | TECH-019: /reports and operational views / scoped metrics / field permissions; DB-019 | AT-019; Phase G |
| PRD-020 / IMP-020 | FLOW-020 / UX-020 | TECH-020: /sync/operations,/operations / request/sync metadata / reauth and idempotency; DB-020 | AT-020; Phase H |
| PRD-021 / IMP-021 | FLOW-021 / UX-021 | TECH-021: /ai/insights / facts,usage / role/tenant/tool/quotas; DB-021 | AT-021; Phase I |
| PRD-022 / IMP-022 | FLOW-022 / UX-022 | TECH-022: /ai/drafts,/confirm / draft audit,normal source / user-bound payload confirmation; DB-022 | AT-022; Phase I |
| PRD-023 / IMP-023 | FLOW-023 / UX-023 | TECH-023: /files / upload_records,private buckets / parent/MIME/size authorization; DB-023 | AT-023; Phase A |
| PRD-024 / IMP-024 | FLOW-024 / UX-024 | TECH-024: /exports,/integrations,outbox / event,attempt / consent,scopes,private result; DB-024 | AT-024; Phase G |
| PRD-025 / IMP-025 | FLOW-025 / UX-025 | TECH-025: /hr / employee,payroll / salary projection/approval; DB-025 | AT-025; Phase J |
| PRD-026 / IMP-026 | FLOW-026 / UX-026 | TECH-026: /settings,/audit,/deactivation / retained evidence / owner/support audit; DB-026 | AT-026; Phase A |

## Release milestones and evidence

| Milestone | Entry / exit | Artifacts and owner |
|---|---|---|
| Development | A/B contracts approved; isolated schema/test fixtures; C–F slices | Tech lead owns versioned contracts/migrations; QA stores actual test output |
| Staging preview | Separate Auth/DB/storage/provider sandbox and confirmed Vercel access; all enabled MVP tests | Auth→Next→FastAPI→Supabase real flow, financial exports, direct Data API attacks, deployment logs; no production credentials |
| Pilot | Reconciled tax-free NGN businesses with signed openings and supported manual payment accounts | Accountant approves cash/AR/AP/stock; product monitors onboarding/debt collection; support uses audited access |
| Production | Pilot passed, costs/SLO/restore demonstrated, approved privacy and scope; explicit release/tenant activation decision | Versioned release record, migration checklist, per-tenant signed cutover, recovery plan; no assumed authorization from documentation completion |
| Expansion | Each P1/P2 capability passes corresponding acceptance/security gate | Measured benefit and budget, approved entitlements/policy, feature flag and rollback |

Production go/no-go checklist:

- [ ] Schema-only baseline, exact migration/grant/policy inventory and representative upgrades are reproducible.
- [ ] Membership, field permission, tenant FK, direct Data API/RPC bypass and Hybrid eligibility tests pass.
- [ ] Financial fixture, opening history, source status, bank/cash, AR/AP, inventory and reports reconcile; no suspense/dual writer.
- [ ] Customer debt collection/corrections work at expired/quota-restricted plans without enabling new forbidden work.
- [ ] Gateway/tax/FX restrictions explicit; only supported businesses activated.
- [ ] Real hosted Auth→UI→API→DB flow verified, no provider/server mocks hiding external failures.
- [ ] Dependency lock/advisory and model/provider health assessed; no security claim based on historic scan totals.
- [ ] Backup/object restore timed and reconciled; RPO/RTO recorded against targets.
- [ ] Accessibility, mobile/offline failure/retry and support recovery tested for enabled scope.
- [ ] Plans/prices/retention/consent/roles approved; logs contain no secrets or raw financial payloads.
- [ ] Release owner signs activation; monitor lock wait, posting errors, job lag, reconciliation and cost.

## Final consistency audit

This documentation audit checks intended contracts; it is not runtime proof. Automatic checks validate seven outputs, local Markdown links, requirement mapping and route inventory; implementation tests remain future work.

| Potential contradiction / dependency | Resolution and remaining action |
|---|---|
| Free/Grow/Scale context vs Starter/Growth/Enterprise repository | Proposed BASE/GROW/TOP stable codes; display names/prices unresolved, TOP only Hybrid; product approval required |
| Setup HYBRID default vs top-tier restriction | B replaces default and server/Data API guards; preserve existing history in restricted downgrade |
| Browser-only gates vs API/Data API exposure | One entitlement/permission policy plus protected DB state and direct-call tests; no client authority |
| Credit page lender offers vs customer receivables | Lending deferred/non-goal; new /receivables and customer repayment; old credit page hidden/redirected |
| Revenue at sale/invoice vs again on repayment | Canonical native allocation; debit treasury/credit AR only; AT-012/013 and report parity |
| Two accounting models and historical mixed data | One active native ledger, immutable legacy evidence, signed import/opening evidence; no automatic activation |
| Transfer treated as cash purpose | C/E require selected cash/bank account; report mapping and treasury fixture before pilot |
| Native cost_price vs weighted-average target | Costing decision/migration gate D; never label current policy as verified weighted average |
| Hybrid freeze vs debt collection and corrections | Restrict new forbidden operations only; history, settlement, authorized correction remain available |
| Posted immutability vs return/edit/delete UX | Credit notes/refunds/reversal with approvals; draft-only edits, no destructive financial deletion |
| Offline capture vs authoritative posting/credit/subscription | Pending drafts only; current server revalidation and explicit conflicts; no final receipt offline |
| AI explanations vs source arithmetic | Trusted calculations/typed permission-filtered facts; model interpretation separately labeled; explicit confirmed drafts |
| Historical docs conflict on DB access/native drivers | Technical audit attributes older notes; freshest deployment config governs build attempt, hosted validation unresolved |
| Advanced screens without actual capabilities | Routes inventoried; unavailable/prototype actions deferred and hidden until corresponding requirements built |
| Report freshness/cash reconciliation vs cache | Tenant/permission/version cache keys and as-of metadata; totals tie to native ledger, fail visible on mismatch |
| Statutory claims, scaling and recovery targets | No compliance or concurrency guarantee; current expert review and measured load/restore gates |

No unresolved item is silently treated as approved. Product/commercial, accounting/tax, provider/privacy and deployed schema/project decisions must be recorded before activating their capabilities. Recommended next implementation work: Phase A schema baseline/access and test fixtures, followed by Phase B entitlement/mode/member vertical slice and Phase C bank-aware canonical accounting validation.
