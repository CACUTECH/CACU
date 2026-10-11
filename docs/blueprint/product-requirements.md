> Blueprint v1 · 11 October 2026 · Repository baseline `71ba8d08dc677f69e5bf0d18a3f00b6c6b22db65`. Source audit and proposed target design; no production activation is implied.

# Product requirements

## Vision, scope and decisions

CACU helps Nigerian nano, micro and small business owners record daily operations and understand cash, profit and customer debt without knowing journal terminology. The customer UI stays simple; every posted financial operation must have balanced, traceable accounting.

MVP: identity, tenant isolation, authoritative plans/modes, catalogues, one stock location, simple service delivery, cash/bank sales, invoices, customer credit and repayments, expenses, reconciled NGN reports and safe attachments. Start with a reconciled, tax-free, single-currency pilot; this pilot restriction is not an assumption that Nigerian businesses are tax-exempt. Taxable businesses require a separate reviewed implementation before activation.

Post-MVP: durable offline drafts, AI insights, verified online gateway collections, tax support, advanced inventory, automated collection reminders, HR, external API, multi-currency. Native mobile, lending, interest/credit scoring, microservices and guaranteed millions of concurrent users are non-goals for this blueprint.

Proposed success targets, to validate with pilot users: 80% finish onboarding in 10 minutes; a trained cashier captures a five-line sale in under 60 seconds; 100% financial fixtures reconcile; zero cross-tenant access in boundary tests; at least 90% of pilot businesses can explain their cash and debt totals from reports; 30-day retention and activation measured without invented current baselines.

## Personas and journeys

| Persona | Daily journey | Required outcome |
|---|---|---|
| Solo retailer | Product setup → receive stock → cash/credit checkout → customer repayment → daily cash check | Accurate stock, cash and debt with no journal entry UI |
| Service proprietor | Service setup → record delivery → issue invoice → collect transfer → profit report | Service revenue and costs without stock prompts |
| Mixed shop/workshop | Top-tier upgrade → Hybrid → goods + work invoice → parts COGS + debt | One customer balance and invoice across both line types |
| Cashier | Owner invitation → limited POS → receipt and permitted debt collection | No salary, margin, account configuration or billing access |
| Accountant | Reconcile opening balances → review postings → close period → export statements | Immutable source-linked ledger and reconciliation |

## Terminology and commercial assumptions

Product/Service/Hybrid are persisted as PRODUCT/SERVICE/HYBRID. Subscription belongs to a business, while a user can belong to several businesses. Employee, customer and Auth identity are different entities. Customer credit means a receivable owed to the business, not CACU lending money.

Repository billing uses Starter, Growth and Enterprise with displayed prices Free, NGN 15000/month and NGN 45000/month. Those are prototype values: billing simulates success and stores the tier locally. Earlier product context uses Free, Grow and Scale. Until product approval, retain stable proposed codes BASE/GROW/TOP and use repository display labels Starter/Growth/Enterprise in migration tests; do not present prototype prices as approved. TOP alone permits Hybrid. Rename display labels centrally after approval without changing persisted eligibility codes.

The following packaging and limits are proposals, not existing enforced entitlements. One subscription per business; users may join unlimited businesses subject to each business's seat allowance. To curb abuse, initial owned-business creation allowance is 1/3/10 for BASE/GROW/TOP per verified owner, enforced centrally and commercially reviewable.

| Capability | BASE | GROW | TOP |
|---|---|---|---|
| Business mode | Product OR Service | Product OR Service | Product, Service, Hybrid |
| Seats including owner/pending invites | 1 | 5 | 25; larger negotiated |
| New commercial documents/month | 100 | 2000 | 10000 |
| Catalogue / customers | 100 / 500 | 5000 / 10000 | 50000 / 100000 |
| Inventory | Single location/basic valuation | Advanced purchase/adjustment reports | Multiple locations after P2 |
| Credit | Issue, collect, balance, ageing | Statements, collection workflows | Automation after P1 |
| Reports | Dashboard, P&L, BS, cash flow, balances | Detailed GL/TB, comparisons, exports | Advanced analytics, API after P2 |
| AI | 10 generic help requests/month, no financial context | 100 tenant insight requests/month | 500 insights including draft assistance after P2 |
| Offline | Pending drafts after P1 | Same, larger authorized cache | Same, advanced sync visibility |
| HR | None | Basic after P2 | Advanced after P2 |
| Support / integrations | Self-service; manual CSV | Email support; approved integrations | Priority support; scoped API after P2 |
| Attachments initial policy | 50MiB / 100 approved files / 10 pending | Same until measured expansion | Same until measured expansion |

Quota definition: issued sale/invoice/expense/purchase consumes one commercial-document unit; draft edits, retries, repayments, corrections, refunds and exports do not. Limit new creation on exhaustion, while continuing debt collection and required corrections. Usage period is UTC calendar month independent of financial date; backdating cannot avoid quota. Seat allocation and usage increments are atomic. AI consumes one reserved invocation per provider call, with refund only if the provider call never starts; additional token/currency budgets apply.

## Subscription lifecycle

Proposed no automatic trial at first release. Any later TOP trial is server-issued, time-bounded and recorded. Upgrade changes entitlements only after verified billing event. Cancellation keeps paid features through paid-through time. On expiry, enter a proposed seven-day grace state for read/export, repayment and corrections, while new paid-feature writes pause. After grace, BASE limits apply. The grace duration requires commercial approval.

If Hybrid loses TOP, retain mode and all history but set restricted state: mixed/new Hybrid operations pause until TOP restored or owner completes a reviewed Product/Service transition. Repayments, corrections and permitted history/export remain available; no silent mode reset. Over-limit staff/catalogue rows remain archived/readable, new creation is blocked, and owner selects active seats/items before normal operations resume. No destructive downgrade.

## Permission model

Current persisted roles are owner/admin/editor/viewer. Keep them as compatibility defaults, then add named permission bundles; do not immediately replace the enum. Proposed bundles below narrow current editor powers. Backend and RLS enforce permissions, never navigation visibility alone.

| Bundle | Permissions | Restrictions |
|---|---|---|
| Owner | All tenant operations, billing, ownership transfer, period approval | Recent verification for transfer; cannot remove last owner |
| Administrator | Tenant settings, staff invitation within own grant ceiling | No ownership/billing by default; no salary/accounting unless delegated |
| Manager | Catalogue, sales, discounts, returns approval, collection | No period close or billing by default |
| Sales staff / cashier | Sale draft/issue, customer lookup, authorized receipt | No manual journals, costs, salaries, limit overrides |
| Inventory staff | Products, receiving and reasoned stock requests | No payment/billing; adjustments above configured threshold need approval |
| Accountant | Reports, journals, AP/AR, reconciliation, corrections | No ownership or HR unless delegated |
| Viewer | Allowed read/export only | No mutation including uploads or AI write drafts |
| HR staff | Employees/attendance/payroll draft | Separate from finance approval and Auth membership admin |

## Requirements register

| Requirement | Name | Priority | Target screen group | Technical / DB / delivery |
|---|---|---|---|---|
| PRD-001 | Identity and sessions | P0 | FLOW-001 | TECH-001 / DB-001 / IMP-001 |
| PRD-002 | Business ownership and switching | P0 | FLOW-002 | TECH-002 / DB-002 / IMP-002 |
| PRD-003 | Plans and entitlements | P0 | FLOW-003 | TECH-003 / DB-003 / IMP-003 |
| PRD-004 | Business modes and migration | P0 | FLOW-004 | TECH-004 / DB-004 / IMP-004 |
| PRD-005 | Staff invitations and permissions | P0 | FLOW-005 | TECH-005 / DB-005 / IMP-005 |
| PRD-006 | Customer and supplier directory | P0 | FLOW-006 | TECH-006 / DB-006 / IMP-006 |
| PRD-007 | Product catalogue | P0 | FLOW-007 | TECH-007 / DB-007 / IMP-007 |
| PRD-008 | Service catalogue and delivery | P0 | FLOW-008 | TECH-008 / DB-008 / IMP-008 |
| PRD-009 | Inventory and purchases | P0 | FLOW-009 | TECH-009 / DB-009 / IMP-009 |
| PRD-010 | Sales and checkout | P0 | FLOW-010 | TECH-010 / DB-010 / IMP-010 |
| PRD-011 | Invoices and receipts | P0 | FLOW-011 | TECH-011 / DB-011 / IMP-011 |
| PRD-012 | Customer credit sale | P0 | FLOW-012 | TECH-012 / DB-012 / IMP-012 |
| PRD-013 | Repayment and allocation | P0 | FLOW-013 | TECH-013 / DB-013 / IMP-013 |
| PRD-014 | Ageing, statements and collection | P0 | FLOW-014 | TECH-014 / DB-014 / IMP-014 |
| PRD-015 | Returns, credit notes and corrections | P0 | FLOW-015 | TECH-015 / DB-015 / IMP-015 |
| PRD-016 | Expenses and supplier payments | P0 | FLOW-016 | TECH-016 / DB-016 / IMP-016 |
| PRD-017 | Double-entry ledger and periods | P0 | FLOW-017 | TECH-017 / DB-017 / IMP-017 |
| PRD-018 | Financial reports and cash flow | P0 | FLOW-018 | TECH-018 / DB-018 / IMP-018 |
| PRD-019 | Dashboard and operational analytics | P1 | FLOW-019 | TECH-019 / DB-019 / IMP-019 |
| PRD-020 | Offline capture and synchronization | P1 | FLOW-020 | TECH-020 / DB-020 / IMP-020 |
| PRD-021 | AI help and business insights | P1 | FLOW-021 | TECH-021 / DB-021 / IMP-021 |
| PRD-022 | AI-assisted transaction drafts | P2 | FLOW-022 | TECH-022 / DB-022 / IMP-022 |
| PRD-023 | Secure attachments | P0 | FLOW-023 | TECH-023 / DB-023 / IMP-023 |
| PRD-024 | Notifications, exports and integrations | P1 | FLOW-024 | TECH-024 / DB-024 / IMP-024 |
| PRD-025 | HR and workforce | P2 | FLOW-025 | TECH-025 / DB-025 / IMP-025 |
| PRD-026 | Administration, privacy and recovery | P0 | FLOW-026 | TECH-026 / DB-026 / IMP-026 |

## Feature contracts

### PRD-001 — Identity and sessions

- **Objective:** identity and sessions with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Identity; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** email, password, verified identity, session.
- **Main workflow:** Register → verify email → login → select business; recover password through allowlisted redirect.
- **Rules:** Reject invalid/expired tokens; generic recovery response; require recent verification for ownership/billing changes.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** A forged session cannot read a tenant; password recovery returns to an allowlisted origin; logout clears tenant state.
- **Traceability:** TECH-001, FLOW-001, UX-001, DB-001, IMP-001; test `AT-001` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-002 — Business ownership and switching

- **Objective:** business ownership and switching with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Owner; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** business name, mode, timezone, membership.
- **Main workflow:** Create business and owner membership atomically; select an authorized business before loading data.
- **Rules:** Never choose an arbitrary first business; reject revoked membership; switching clears caches and drafts from view.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Two businesses with the same customer name never share records; membership revocation rejects the next write.
- **Traceability:** TECH-002, FLOW-002, UX-002, DB-002, IMP-002; test `AT-002` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-003 — Plans and entitlements

- **Objective:** plans and entitlements with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Owner, billing admin; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** plan version, subscription status, limits, usage, provider event.
- **Main workflow:** Read effective entitlements → reserve quota → perform operation → record usage; billing upgrade waits for verified provider event.
- **Rules:** No browser tier authority; fail closed on unavailable policy; replay does not charge usage twice.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Editing localStorage or replaying a payment redirect cannot unlock Hybrid; two requests for the last seat cannot both succeed.
- **Traceability:** TECH-003, FLOW-003, UX-003, DB-003, IMP-003; test `AT-003` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-004 — Business modes and migration

- **Objective:** business modes and migration with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; Hybrid top tier; Product, Service, Hybrid.
- **Roles / permissions:** Owner; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** current mode, requested mode, entitlement, impact report.
- **Main workflow:** Choose Product or Service at setup; eligible top-tier owner enables Hybrid; mode change produces impact preview.
- **Rules:** Do not delete history; product stock must be reconciled before Service-only operation; downgrade freezes forbidden new work.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Lower-tier direct API and Data API attempts to activate Hybrid fail; past mixed invoices remain readable.
- **Traceability:** TECH-004, FLOW-004, UX-004, DB-004, IMP-004; test `AT-004` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-005 — Staff invitations and permissions

- **Objective:** staff invitations and permissions with authorized, explainable business results.
- **Priority / tiers / modes:** P0; Paid seats; owner on base; All.
- **Roles / permissions:** Owner, delegated admin; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** normalized email, role, permission set, expiry, token digest.
- **Main workflow:** Invite → accept with matching verified identity → atomically reserve seat and create membership → revoke when offboarding.
- **Rules:** Single-use seven-day invitation; invited seats count toward limits; last owner cannot be removed.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Expired invite fails; revoked cashier cannot post; admin cannot self-promote to owner or grant permissions they lack.
- **Traceability:** TECH-005, FLOW-005, UX-005, DB-005, IMP-005; test `AT-005` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-006 — Customer and supplier directory

- **Objective:** customer and supplier directory with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Editor with directory.write; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** name, phone, optional email, terms, active flag.
- **Main workflow:** Create/search/update party; archive instead of deleting referenced identity; view tenant statement.
- **Rules:** Name need not be unique; normalize phones; duplicate warning; customer credit is separate from lender offers.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** A foreign customer UUID cannot be attached to an invoice; archiving retains outstanding debt and history.
- **Traceability:** TECH-006, FLOW-006, UX-006, DB-006, IMP-006; test `AT-006` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-007 — Product catalogue

- **Objective:** product catalogue with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; Product, Hybrid.
- **Roles / permissions:** Inventory staff; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** SKU, name, price, cost mapping, unit, reorder threshold.
- **Main workflow:** Add product → maintain price → archive when discontinued.
- **Rules:** Unique active SKU per business; price decimal; no direct opening-stock overwrite; version prices.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Duplicate SKU rejected; price change does not rewrite issued invoice snapshots.
- **Traceability:** TECH-007, FLOW-007, UX-007, DB-007, IMP-007; test `AT-007` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-008 — Service catalogue and delivery

- **Objective:** service catalogue and delivery with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; Service, Hybrid.
- **Roles / permissions:** Service manager; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** service name, price, duration, delivery record, direct costs.
- **Main workflow:** Create service → quote/invoice → mark delivery → record attributable costs.
- **Rules:** Services never decrement stock; delivery and revenue recognition follow agreed policy; initially delivery at invoice issue.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Service invoice leaves stock unchanged; failed/cancelled delivery requires explicit correction rather than erasing a posted invoice.
- **Traceability:** TECH-008, FLOW-008, UX-008, DB-008, IMP-008; test `AT-008` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-009 — Inventory and purchases

- **Objective:** inventory and purchases with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All in Product; advanced paid; Product, Hybrid.
- **Roles / permissions:** Inventory staff, accountant; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** SKU, quantity, location, unit cost, supplier, source document.
- **Main workflow:** Receive purchase → post inventory/payable → move/adjust stock with reason → reconcile inventory control.
- **Rules:** Integer stock units for initial release; weighted-average valuation target requires reviewed migration from current locked cost_price; block negative stock.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Two simultaneous sales of the last unit cannot both post; purchase cost/stock/audit roll back together.
- **Traceability:** TECH-009, FLOW-009, UX-009, DB-009, IMP-009; test `AT-009` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-010 — Sales and checkout

- **Objective:** sales and checkout with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All within quota; All.
- **Roles / permissions:** Cashier or sales staff; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** lines, customer for credit, authoritative prices, payment split, request key.
- **Main workflow:** Capture lines → validate quote → select payment → server issues sale and posting → receipt.
- **Rules:** Mixed product/service lines only Hybrid; no card success without verified settlement; stable retry key; discounts require permission.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Stale prices return conflict; timeout retry returns original sale; product COGS posts once; services never consume stock.
- **Traceability:** TECH-010, FLOW-010, UX-010, DB-010, IMP-010; test `AT-010` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-011 — Invoices and receipts

- **Objective:** invoices and receipts with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All within quota; All.
- **Roles / permissions:** Sales staff, cashier; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** number, issue/due dates, party, snapshots, status, source mapping.
- **Main workflow:** Draft → review → issue → collect partial/full amount → render/share receipt and statement.
- **Rules:** Draft mutable; issued immutable; due date >= issue date; unique tenant number; share requires explicit recipient/action.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Issuing twice posts once; payment receipt reports outstanding amount; issued edits require credit note/reissue.
- **Traceability:** TECH-011, FLOW-011, UX-011, DB-011, IMP-011; test `AT-011` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-012 — Customer credit sale

- **Objective:** customer credit sale with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All basic; paid automation; All.
- **Roles / permissions:** Credit-authorized sales staff; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** customer, credit limit, eligible flag, due date, cash portion, AR account.
- **Main workflow:** Identify customer → check exposure → issue credit/partial-credit sale → record initial cash allocation.
- **Rules:** Credit limit optional and nonnegative; include all issued unpaid debt; no credit without customer; offline capture remains pending.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** NGN 100000 sale with 40000 cash creates revenue 100000, cash 40000 and AR 60000; stock/COGS occurs once.
- **Traceability:** TECH-012, FLOW-012, UX-012, DB-012, IMP-012; test `AT-012` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-013 — Repayment and allocation

- **Objective:** repayment and allocation with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All basic; All.
- **Roles / permissions:** Cashier with payments.record; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** customer, amount, cash/bank account, invoice allocation list, reference, request key.
- **Main workflow:** Receive repayment → select invoices or oldest due → lock exposure → allocate → commit → receipt.
- **Rules:** No allocation above outstanding; one customer per receipt; excess only as explicit customer advance; never count repayment as revenue.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Repay 25000 on 60000 debt: AR becomes 35000 and revenue unchanged; concurrent 40000 receipts cannot over-allocate.
- **Traceability:** TECH-013, FLOW-013, UX-013, DB-013, IMP-013; test `AT-013` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-014 — Ageing, statements and collection

- **Objective:** ageing, statements and collection with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All balances; paid automated reminders; All.
- **Roles / permissions:** Owner, accountant, credit manager; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** as-of date, issued invoices, allocations, due dates, contact preference.
- **Main workflow:** Show customer debt → drill down → generate statement → log manual follow-up; scheduled reminders later.
- **Rules:** Buckets not due, 1–30,31–60,61–90,91+ days overdue; invoice without due date shown separately; no invented due date.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Ageing total equals receivables subledger at as-of; later receipts do not change historical statement; reminders respect consent.
- **Traceability:** TECH-014, FLOW-014, UX-014, DB-014, IMP-014; test `AT-014` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-015 — Returns, credit notes and corrections

- **Objective:** returns, credit notes and corrections with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Manager with corrections.approve; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** original document, quantities, reason, refund account, approval.
- **Main workflow:** Review original → issue bounded credit note → record stock condition → allocate/refund → audit.
- **Rules:** Return cannot exceed remaining sold quantity; restore original cost only for sellable stock; already allocated documents need credit-note workflow.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Repeated return cannot restore stock twice; closed-period correction uses permitted current period and reference.
- **Traceability:** TECH-015, FLOW-015, UX-015, DB-015, IMP-015; test `AT-015` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-016 — Expenses and supplier payments

- **Objective:** expenses and supplier payments with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Accountant, authorized owner; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** supplier, category/account, amount, paid/unpaid, document date, due date.
- **Main workflow:** Record expense/bill → post → settle payable → attach evidence.
- **Rules:** Separate paid expense from unpaid bill; bank transfer uses bank account; capital asset cannot be expensed by default.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Unpaid expense increases AP, settlement reduces AP without a second expense; atomic audit failure cancels posting.
- **Traceability:** TECH-016, FLOW-016, UX-016, DB-016, IMP-016; test `AT-016` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-017 — Double-entry ledger and periods

- **Objective:** double-entry ledger and periods with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All engine; paid advanced UI; All.
- **Roles / permissions:** Accountant; owner manages periods; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** accounts, entity mappings, period, posting commands, opening evidence.
- **Main workflow:** Provision reviewed ledger → validate balanced posting → commit source/stock/ledger/audit → reconcile → lock period.
- **Rules:** One canonical ledger per activated tenant; no dual writes; decimal arithmetic; posted rows immutable; no automatic period creation.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Unbalanced journal fails at commit; wrong-tenant account rejected; original remains after audited reversal; locked period rejects posting.
- **Traceability:** TECH-017, FLOW-017, UX-017, DB-017, IMP-017; test `AT-017` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-018 — Financial reports and cash flow

- **Objective:** financial reports and cash flow with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All core; paid drilldown/comparison; All.
- **Roles / permissions:** Owner, accountant, permitted reader; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** period, posted ledger, mappings, cash policy.
- **Main workflow:** Select dates → aggregate posted ledger → reconcile → drill down → export permitted report.
- **Rules:** NGN initial scope; cash flow indirect; cash transfers net zero; missing mappings fail visibly; no suspense plug or mock fallback.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Opening cash + operating + investing + financing + FX = closing cash; TB difference zero; balance sheet reconciles.
- **Traceability:** TECH-018, FLOW-018, UX-018, DB-018, IMP-018; test `AT-018` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-019 — Dashboard and operational analytics

- **Objective:** dashboard and operational analytics with authorized, explainable business results.
- **Priority / tiers / modes:** P1; All basic; paid advanced; All.
- **Roles / permissions:** Role-filtered member; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** period totals, low stock, delivery records, aged debt.
- **Main workflow:** Read mode-specific dashboard → drill down to supporting list → choose action.
- **Rules:** Permission-filter metrics; show as-of and stale/offline badges; financial totals from canonical ledger.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Cashier cannot fetch profit through hidden dashboard API; Service mode omits stock widgets.
- **Traceability:** TECH-019, FLOW-019, UX-019, DB-019, IMP-019; test `AT-019` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-020 — Offline capture and synchronization

- **Objective:** offline capture and synchronization with authorized, explainable business results.
- **Priority / tiers / modes:** P1; All basic drafts; All.
- **Roles / permissions:** Any role with online-equivalent capture permission; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** device/op IDs, tenant/user namespace, local drafts, version, request key.
- **Main workflow:** Capture pending draft → persist → reconnect → reauthenticate → validate → submit stable command → resolve conflicts.
- **Rules:** No offline final posting, credit guarantee, invite or upgrade; browser storage may be evicted; do not promise lossless persistence.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Restart restores surviving draft; logout hides/purges local tenant data; price change prompts review; replay creates one posting.
- **Traceability:** TECH-020, FLOW-020, UX-020, DB-020, IMP-020; test `AT-020` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-021 — AI help and business insights

- **Objective:** ai help and business insights with authorized, explainable business results.
- **Priority / tiers / modes:** P1; All help; paid tenant insights; All.
- **Roles / permissions:** Member with ai.use and data permissions; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** question, typed authorized aggregates, source/time metadata, usage reservation.
- **Main workflow:** Ask question → enforce budget/access → fetch bounded facts → generate structured explanation → display evidence.
- **Rules:** No arbitrary SQL; no cross-tenant context; financial arithmetic computed by trusted code; timeout/quota gives ordinary help.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Prompt injection cannot retrieve another business; unsupported metric returns unavailable; quota reservation prevents parallel overspend.
- **Traceability:** TECH-021, FLOW-021, UX-021, DB-021, IMP-021; test `AT-021` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-022 — AI-assisted transaction drafts

- **Objective:** ai-assisted transaction drafts with authorized, explainable business results.
- **Priority / tiers / modes:** P2; Top tier; All.
- **Roles / permissions:** Authorized transaction creator; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** user text, allowlisted draft schema, catalog candidates, confirmation token.
- **Main workflow:** Interpret → validate draft → show exact lines/amounts/date → user confirms → normal posting boundary.
- **Rules:** AI cannot commit; confirmation bound to user, tenant, payload hash and short expiry; permissions rechecked at commit.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Changing a confirmed amount invalidates confirmation; withdrawn permission blocks posting; duplicate confirm posts once.
- **Traceability:** TECH-022, FLOW-022, UX-022, DB-022, IMP-022; test `AT-022` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-023 — Secure attachments

- **Objective:** secure attachments with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All within quota; All.
- **Roles / permissions:** Upload-purpose role; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** file purpose, resource UUID, MIME, bytes, approved metadata.
- **Main workflow:** Authorize parent → reserve → quarantine → decode/re-encode → approve → authorized download/delete.
- **Rules:** Current PNG/JPEG only; UUID names/private buckets; logo 2MiB, receipts 3MiB; PDFs not supported until separately designed.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Spoofed MIME/script file rejected; foreign invoice attachment rejected; cleanup failure tracked; no public URL grants access.
- **Traceability:** TECH-023, FLOW-023, UX-023, DB-023, IMP-023; test `AT-023` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-024 — Notifications, exports and integrations

- **Objective:** notifications, exports and integrations with authorized, explainable business results.
- **Priority / tiers / modes:** P1; All manual; paid automation/API; All.
- **Roles / permissions:** Role-appropriate member; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** event, recipient consent, export job, provider configuration.
- **Main workflow:** Commit business event → enqueue outbox → deliver with retries; export from snapshot and authorized scope.
- **Rules:** No credentials in browser; signed webhook validation and event deduplication; sanitize CSV formula cells; exports expire.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Notification outage cannot undo a sale; duplicate event delivers one receipt; export cannot include forbidden columns.
- **Traceability:** TECH-024, FLOW-024, UX-024, DB-024, IMP-024; test `AT-024` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-025 — HR and workforce

- **Objective:** hr and workforce with authorized, explainable business results.
- **Priority / tiers / modes:** P2; Paid; top advanced; All.
- **Roles / permissions:** Dedicated HR permission; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** employee, attendance, payroll inputs and policy version.
- **Main workflow:** Maintain staff records → review attendance → calculate draft payroll → approve → post controlled expense/payment.
- **Rules:** Employee record is not login membership; no statutory payroll claim before current tax/pension review; protect salary columns.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Cashier cannot fetch salaries; payroll approval/version audit retained; leaving employee does not silently revoke Auth identity.
- **Traceability:** TECH-025, FLOW-025, UX-025, DB-025, IMP-025; test `AT-025` exercises the acceptance above at UI/API/database boundaries where applicable.

### PRD-026 — Administration, privacy and recovery

- **Objective:** administration, privacy and recovery with authorized, explainable business results.
- **Priority / tiers / modes:** P0; All; All.
- **Roles / permissions:** Owner; platform operator via audited support; use the permission model above and deny any unlisted mutation.
- **Preconditions:** Verified session, active membership and permitted feature/plan, except public identity entry. Financial mutations also need a reconciled active ledger and open period.
- **Data:** retention category, export/delete request, backup evidence, audit events.
- **Main workflow:** Configure business → export → deactivate → apply reviewed retention; test restore in isolated environment.
- **Rules:** No automatic erasure of financial history; support access time-bound and audited; RPO/RTO are targets until restore measured.
- **Alternate/failure:** Invalid data returns field errors without writes; revoked permission returns denied; timeout retains request key and offers status/retry. Unsupported policy shows its explicit release restriction.
- **Acceptance:** Restore reproduces reconciled balances; deactivation blocks new writes; no PII or bearer token in error logs.
- **Traceability:** TECH-026, FLOW-026, UX-026, DB-026, IMP-026; test `AT-026` exercises the acceptance above at UI/API/database boundaries where applicable.

## Non-functional acceptance and open decisions

Proposed SLOs, measured before claiming readiness: ordinary list/read p95 <500ms backend and posting p95 <2s at 50 requests/second across 100 pilot tenants; financial report p95 <5s for a tenant with 100000 ledger legs; 99.5% monthly availability pilot target. Reject rather than partially commit on capacity failure. Test 360px layouts, keyboard-only checkout and WCAG 2.2 AA (see design-system). Recovery targets: RPO 24h/RTO 8h pilot, moving to RPO 15min/RTO 4h with confirmed PITR and restore evidence. Offline drafts are outside server backup coverage until synced.

Privacy/retention are unresolved product/legal decisions: classify accounting evidence, customer contact data, AI prompts, uploads and logs separately; obtain current Nigerian legal review before final policy. Proposed AI conversation retention 30 days, operational logs 30 days, no raw prompt in ordinary logs; financial records retained under approved policy, never erased automatically when a subscription ends.

Decisions requiring approval before implementation: names/prices and quotas, TOP seat expansion, grace policy, costing and delivery/recognition policy, tax mappings, gateway provider and settlement rules, permitted sharing channels, statutory retention and HR/tax scope. Missing decisions do not authorize bypassing accounting or tenant protections.
