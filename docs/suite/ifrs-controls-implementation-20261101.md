# IFRS controls implementation and release review

Date: 1 November 2026. Branch: feat/ifrs-gap-remediation. Baseline: c2097daacfd6700b7b6afdd837b2cf83d1fbd615.

## What is implemented

The gap register now includes implementation evidence and explicit remaining review/scope for all 18 items. This is a controlled accounting implementation, not a full-IFRS compliance certificate. No production migration, balance, user account, template approval or deployment setting was changed. Commercial rules and email delivery remain excluded. Existing unrelated work and the earlier chart sign-off documents are preserved.

### Inventory (IAS 2)

The Inventory module links to `/inventory/valuation`. An Owner/Admin first approves moving weighted average for appropriate interchangeable goods, names the accountant-approved policy evidence and selects a dedicated, unused operating current-asset contra account for NRV allowances. An account with existing posting history is refused even if its current balance is zero. Formula adoption is immutable; changing it requires a separately reviewed migration. This release does not implement FIFO or specific identification and must not be adopted for goods requiring those methods without further implementation.

Each item is adopted from its reconciled current quantity and catalogue cost, using today's date. Adoption records a valuation snapshot and does not repost opening stock. Legacy quantities and exact-cent costs must first reconcile; negative stock is refused. Existing, unadopted stock continues through its previous workflow. Close approval requires all relevant items and inventory controls to reconcile.

Goods receipts match received item quantities and allocated eligible costs to one supplier bill. They debit inventory, debit separately reviewed recoverable tax where applicable and credit the supplier payable. The existing supplier-payment workflow then settles that same bill. Purchase costs, rebates, landed costs and tax amounts are explicit line totals; shared costs must be allocated by the approved policy and the entered components must belong to that bill. Third-party freight must not be charged to the wrong supplier. Abnormal waste or noneligible overhead must not be capitalised. This is not automatic purchasing, production-overhead or tax-law determination.

Sales issue cost from exact item totals; the final unit absorbs the remaining cents. Catalogue unit cost is an approximate four-decimal display/reference value, not the valuation control total. Item cost, quantity, valuation events, ledger entries and durable request replay share one transaction. Direct manual postings to adopted inventory/allowance controls are refused; use the valuation workflows. Existing catalogue guards remain in place and permit a cost update only when it exactly matches authorised adopted valuation state.

NRV assessments use estimated total selling value less completion/selling costs for all units held. They create a separate allowance, retain quantity, reverse only the existing allowance and never increase carrying amount above original cost. A sale releases its proportional allowance to cost of sales. Quantity losses release the related allowance through the reviewed adjustment offset. Gross inventory controls reconcile separately from the allowance; dashboard inventory is net carrying value.

Returns reference an original valued issue, cannot exceed unreturned units and restore that issue's cost and allowance. Unpaid invoice amounts receive an allocated credit note; any paid amount requires an explicit Cash/Transfer refund through a reviewed collection account. POS returns are refunded explicitly. Refund, credit, stock and valuation updates are atomic and protected against independent journal reversal. Pre-adoption issues without reliable valuation evidence are refused rather than assigned invented historical costs.

Events must be chronological per item, with recording order determining the sequence on a single date. Prior periods are not silently recosted. Closed periods, future dates and stock/valuation discrepancies are refused. Approved quantity adjustments retain their exact requested value; a changed valuation requires a fresh request.

### Cash flows (IAS 7)

Ordinary investing/financing cash receipts and payments are shown gross, with traceable ledger details. Explicit dated classifications separate interest, dividends and income-tax cash disclosures without duplicating totals, including allocated supplier payments and customer receipts. Accruals alone do not become cash disclosures. New standard-chart provisioning gives the standard interest account its semantic purpose; existing custom/legacy accounts need Owner/Admin classification in the valuation/review screen.

Cash eligibility is distinct from restrictions and transaction classification. An unreviewed `restricted` mapping blocks the report rather than automatically treating it as investing. A qualifying reviewed demand deposit remains cash, with a restriction disclosure. Integral overdrafts/cash equivalents require reviewed facts; selecting a category does not prove the underlying criteria. Cash classification changes inside a report period require splitting/reviewing that transition. Dated records are immutable, and duplicate effective-date changes return a clear conflict.

The report and CSV/Excel/PDF include cash components, restrictions and financing-liability opening/cash/noncash/closing movements. Dashboard cash uses the same reviewed eligibility. Complete cash-equivalent policies, financial-position reconciliation differences and applicable supplier-finance terms/disclosures belong in the close notes. Complex noncash structures and exceptional netting arrangements still require accountant assessment.

### Financial close and other standards

`/accounting/policies` is now a working close workspace linked from Reports. Every gap item requires an applicability assessment, substantive note and review evidence, including reasons for exclusions. Presentation, cash policy, functional currency and close-note reviews cannot simply be marked inapplicable.

The package includes income and financial-position statements, comparative columns, comprehensive income, changes in equity, cash-flow/component/financing notes, supporting schedules, maturity adjustments and review issues. The complete JSON review package and statements/notes PDF are exportable. Equity ledger movements need explicit owner/OCI/distribution/transfer/error classification. Current loan portions are reclassified within this close package from dated contractual/covenant assessments, without rewriting ledger balances. Ordinary management reports continue to show their ledger account classifications; use the reviewed close package for these presentation adjustments.

External professional schedules integrate IFRS 9/7 measurement/risk review, IAS 16/36/38 assets, IFRS 16 leases, IAS 12 current/deferred income tax and IAS 19 employee benefits. Import the supporting template and the business account reference. Each schedule records calculation assumptions and evidence, and its signed debit opening plus positive debits less positive credits must equal closing. Rows are aggregated per account and reconciled against actual ledger opening, gross movements and closing, including related asset/expense/allowance/liability controls. Measurements must be calculated and reviewed externally, and any necessary journals posted through the existing journal workflow before reconciliation. These are integrated external schedules, not automatic ECL, depreciation, lease, tax or actuarial engines.

Policies, estimates, errors/restatements, subsequent events, related parties, provisions/contingencies, going concern, cash policies and supplier finance require actual accountant-prepared disclosures. Attach/reference the signed source work; arbitrary note text or a balanced trial balance is not assurance.

Invoice creation is explicitly scoped to satisfied obligations. The invoice UI records delivery/completion confirmation and evidence. An advance, an unsatisfied obligation, performance after invoice date or an over-time contract is refused by the native issue workflow. Existing clients retain the completed-sale contract default for compatibility; such requests are audit-flagged as legacy confirmations and their supporting performance evidence requires review. This release does not implement advance billing, contract liabilities or over-time revenue schedules.

Only NGN-functional, single-currency entities are supported. Do not record unsupported foreign monetary transactions as NGN to evade the currency boundary. Full IFRS and IFRS for SMEs are not interchangeable frameworks.

Annual closes require corresponding preceding-year coverage. Missing pre-cutover activity or comparative ledger coverage is reported as incomplete, not approved as a zero comparative. Such cases need a separately prepared, reviewed historical/comparative package and further integration before in-app approval. A short first annual period likewise requires separate review.

IFRS 18 is handled by reporting-period start and early-adoption decision, not by the date the report is printed. The release records a transition plan and blocks approval of periods beginning on/after 1 January 2027, or early adoption, until the required presentation engine and transition package are implemented/reviewed. That future engine is NOT claimed complete here. The plan covers profit categories/subtotals, operating-profit cash-flow starting point, interest/dividend classifications and retrospective comparatives/reconciliations.

Close versions and approval evidence are immutable. An independent Owner/Admin records approval after an accountant review and all reconciliation gates pass; the submitter cannot approve their own version. Every retrieval checks the ledger, chart, opening basis, valuation and cash-policy fingerprint. Subsequent relevant changes invalidate the recorded review and require a fresh submission. The accountant's name/reference is an attestation recorded by the submitting user, not verification of professional qualifications or an audit opinion. The output retains management-statement qualifications and no automatic IFRS-compliance claim.

## Deployment and activation

1. Review the migration diff, tested backup/restore arrangements and the scope items above. Use an isolated staging database for acceptance before production activation. Local tests here never use CACU_DATABASE_URL.
2. Apply 20261101174817_ifrs_inventory_and_reporting_close.sql then 20261101174820_ifrs_catalog_valuation_guard.sql. The two new additive migrations follow existing history in dependency order: inventory/reporting-close tables first, then the catalogue valuation guard. They add private accounting tables, tenant composite keys, forced RLS and restricted runtime grants; there are no table drops or business-balance rewrites.
3. Deploy backend before or together with the frontend. The existing CACU_ACCOUNTING_API_URL, CACU_DATABASE_URL, Supabase auth configuration and TLS setup remain required. There are no new provider secrets or dependency upgrades.
4. Restore/verify legacy balances and normal workflows in staging, then have the Owner/Admin and accountant approve eligible costing/cash policies and reconcile adopted stock before use. Do not mark NG-2026.1 reviewed merely because this code is installed.
5. Prepare real ECL, asset, lease, tax, benefits, financing, maturity, policy and note schedules where applicable. Post reviewed adjustments, import reconciliations, resolve issues and obtain independent close approval.
6. Pre-cutover comparatives and IFRS 18 readiness remain explicit release limitations requiring external preparation/further implementation. Never replace actual business history with sample balances.

## Compatibility and rollback

All schema changes are additive. Existing stock, invoices, parties, postings and audits are retained. New strict request fields are additive, and the original default invoice hashes remain replay-compatible. New API contracts are generated in backend/openapi.json and src/lib/accounting-contract.ts. Cash-flow labels intentionally distinguish gross receipts and payments; exports and comparison consumers were updated together.

Before any policy/item adoption, rolling back application code can leave the additive tables in place. After adoption or NRV postings, do NOT run the old catalogue-cost writer: it cannot maintain the adopted exact valuation and allowances. Suspend affected accounting/inventory writes, preserve all new tables/events/journals/approvals, and roll forward a reviewed correction or reconciliation. Do not drop tables, delete valuation events, reset stock or reverse one leg independently. Restoring a backup requires a reviewed business-wide recovery plan, not an automatic down migration.

## Verification

Initial existing-accounting regression: 61 passed. Initial new acceptance: 6 passed (costing, NRV/reversal cap, unpaid/paid returns, cash classification, approval, stale reviews, tenant boundaries). Frontend CI: 289 tests passed, with lint/typecheck. Final validation is recorded below and in ifrs-validation-20261101.json. Early implementation failures (catalogue guard integration and Python metadata-query quoting) were corrected. An obsolete unavailable-page assertion and one new browser label locator were updated to match the implemented, accessible workflow; no pre-existing product failure is being concealed.

## Standards references

[IAS 2](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/), [IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/), [IAS 1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/), [IFRS 18](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-18-presentation-and-disclosure-in-financial-statements/). Other applicable-standard references and the original source review remain in ifrs-gap-assessment-20261101.md.


## Final validation update

- Full isolated Python suite: **425 passed**, 971 warnings, before the last edge-case refinements. No skipped database setup was used: separate local accounting, setup and AI test databases were configured.
- Final affected inventory/report/security/property regression: **46 passed** after refreshing the unshipped migration versions into dependency order.
- Final IFRS acceptance run: **8 passed**, covering the latest unchanged-cost catalogue edit, stale-close replay and dedicated-account-history protections as well as costing/NRV, returns/refunds, cash flows, maturity/schedule ties and approval/tenant controls.
- Final frontend CI: lint and TypeScript checks passed; **289 tests in 38 suites passed**.
- Browser regression: **50 passed with two workers**. The later close-form test also passed independently after adding a real submission and disabled-approval assertion. One default-parallel run timed out at the existing cash-report loading assertion; the bounded-parallel full suite passed without changing that product behavior or weakening the assertion.
- Final production Next.js build: **passed**, including the new `/inventory/valuation` and `/accounting/policies` routes.
- Local metadata audit: all seven new private accounting tables enforce forced RLS, with no anon/authenticated table privileges. Immutable evidence tables have no runtime UPDATE/DELETE grants. The catalogue trigger function is not publicly executable.
- Final diff review: no dependency upgrades, provider/billing/email changes, production mutations or unrelated staged-file changes. OpenAPI and TypeScript contracts are generated through the repository's existing workflow.

These checks establish tested implementation behavior, not an entity's complete IFRS compliance or accountant approval. Deploy the migrations/backend/frontend and complete the listed human accounting reviews before activation.
