# CACU NG-2026.1 - IFRS gap assessment

Review date: 1 November 2026. Repository commit: c2097daacfd6700b7b6afdd837b2cf83d1fbd615. Branch: feat/r1-statement-comparatives.

## Conclusion

Full IFRS compliance is NOT demonstrated. The chart is a useful R1 management-accounting foundation, not an IFRS compliance certificate. Specific IAS 7 presentation problems were reproduced in the current report function. Inventory valuation and complete statement/disclosure coverage require further work and evidence. Keep accountant sign-off pending; do not relabel the output IFRS compliant based on account names, a balanced trial balance or this review.

IAS 1 prohibits describing financial statements as IFRS-compliant unless all applicable requirements are met. Compliance is assessed for an entity's complete financial statements, recognition, measurement, presentation, policies and disclosures; IFRS does not prescribe CACU's account numbers. A missing optional software module is not automatically a breach for an entity with no corresponding transactions, and professional external schedules/manual adjustments may support compliance only if the final statements fully incorporate and reconcile them. [IAS 1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/).

This is an engineering/accounting gap assessment, not an audit or professional sign-off. It reviews source and synthetic behavior, not an entity's signed financial statements or actual transactions. No production records, account balances, approval flags or software behavior were changed. Existing in-progress work, earlier sign-off documents and account-review worksheets were preserved.

## Framework and effective dates

The requested baseline is full IFRS Accounting Standards for a 2026 reporting period, assuming no early adoption of IFRS 18. Confirm whether each business instead qualifies and elects the separate IFRS for SMEs framework under applicable local requirements. Do not mix selected full-IFRS and SME rules without a valid framework basis. The third SME edition is effective for periods beginning on/after 1 January 2027, with early application permitted. [IFRS for SMEs](https://www.ifrs.org/issued-standards/ifrs-for-smes/).

IFRS 18 replaces IAS 1 for annual reporting periods beginning on/after 1 January 2027, with early application permitted. It changes presentation and consequential IAS 7 requirements, including the indirect-method starting point to operating profit and updated interest/dividend classification. Version policies by reporting period and early-adoption decision; a statement issued during 2027 may still cover a period beginning before that date. Operating interest classification is not automatically wrong under pre-IFRS-18 IAS 7; separate disclosure and consistent policy remain necessary. [IFRS 18](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-18-presentation-and-disclosure-in-financial-statements/), [IAS 7 amendments](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/).

## Evidence and existing strengths

Inspected default chart migration, chart.py, accounts.py, posting.py, stock.py, catalog.py, workflows.py, bills.py, activation.py, reports.py, report UI and relevant existing test definitions. Product/Hybrid standard templates have 28 accounts; Service has 24. Existing controls include mapped inventory/COGS and cash/bank, atomic posting and request-key replay, tenant checks, stock-event history, approved opening-position activation, AR/AP allocation, first-period cash-flow brought-forward handling and non-cash corrections. Detailed income/position statements and optional comparatives are now implemented on this branch; the earlier claim that all comparatives were missing would be stale.

Reports correctly retain the label Management statements, not reviewed. Keep that label until a valid reviewed statement process exists. Mechanical chart validation confirms mapping consistency, not IFRS accounting completeness. Generic custom accounts and manual journals are available; they do not by themselves prove compliant measurement or disclosure. Full production reconciliation, valuation schedules, note completeness and accountant evidence were not tested in this review.

## IAS 2 Inventories

IAS 2 requires the lower of cost and net realisable value, eligible purchase/conversion costs, permitted cost formulas and recognition of inventory expense with related revenue. Different goods may require different appropriately applied formulas; an approved policy is needed, not a mandatory choice of weighted average for every item. [IAS 2 summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/), [IAS 2 text](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-2-inventories.pdf).

Current posting.py values fulfillment from catalog_items.cost_price multiplied by quantity and posts COGS with revenue. That is a useful consistency control, but a single catalog cost is not evidence of a correct FIFO, weighted-average or specific-identification calculation when purchase costs vary. stock.py supports reasoned, approved quantity adjustments; no dedicated NRV assessment, value-only write-down, capped reversal or valuation disclosures were found. Quantity write-offs are not a substitute for NRV measurement of stock still held.

bills.py deliberately accepts expense accounts and defers stock purchases to a future goods-receipt flow. Therefore it must not be used to expense material unsold inventory as a workaround. Landed costs, rebates, recoverable versus nonrecoverable taxes, conversion overhead, abnormal waste and borrowing costs for qualifying assets need scoped policy and examples. Manual adjustments would also have to preserve inventory/control reconciliation.

Acceptance examples: two differently priced receipts followed by a partial sale; freight/rebate allocation; customer return at appropriate carrying amount; inventory cost 100, NRV 80, later partial/full recovery capped at original cost; no quantity change for a pure valuation write-down. Sources for borrowing-cost treatment: [IAS 23](https://www.ifrs.org/issued-standards/list-of-standards/ias-23-borrowing-costs/).

## IAS 7 Statement of Cash Flows

The function already separates operating/investing/financing totals and reconciles opening cash plus net change to closing ledger cash. Those are valuable controls. They do not establish correct gross presentation or disclosure. Major investing/financing cash-flow classes generally require gross presentation, subject to the actual exceptions; interest/dividend flows require separate disclosure. [IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/), [IAS 7 text, paragraphs 21-24 and 31-34](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ias-7-statement-of-cash-flows.pdf).

Confirmed synthetic probes (invented amounts, no database):

- Loan proceeds 100 and repayments 40 produce ONE financing line Loans and borrowings = 60. The net cash movement reconciles, but the ordinary gross proceeds/repayment classes disappear.
- Interest paid 10 appears only as operating Net profit = -10, with no separate interest-paid line in the sections rendered by the UI. A drill-down detail is not automatically equivalent to presenting required separate cash disclosures.

These ran the actual cash_flow function with synthetic ledger rows and mocked library/database objects. Results are in ifrs-review-probes-20261101.json. They prove those calculation/presentation behaviors for the probes, not end-to-end database, report-export or entity compliance. An initial script import was adjusted to the application's upstream library initialization order; no product code was changed.

Conditional problem: reports.py maps any flow_section restricted to investing. Restrictions alone do not determine whether a demand deposit remains cash. Cash eligibility, restriction disclosures and transaction classification need distinct reviewed facts; existing NG-2026.1 need not contain a restricted mapping for this code path to need correction before future use. [IFRIC demand-deposit decision](https://www.ifrs.org/news-and-events/updates/ifric/2022/ifric-update-march-2022/).

Further evidence needed: cash-equivalent eligibility and qualifying overdrafts; cash-component reconciliation to financial position; interest/dividends/income-tax flows; gross investing/financing proceeds and payments; non-cash transaction notes; financing-liability movement reconciliation and applicable supplier-finance disclosures. Only a valid NGN-only scope can support the current hardcoded zero FX effect.

## Other relevant standards - applicability and gaps

The CSV register contains detailed evidence, priorities, proposed actions and acceptance examples. Main areas:

- IAS 1: current statements and comparative options do not supply a complete statement set with OCI where applicable, changes in equity and material notes. 2500 is a non-current loan account; contractual current portions/covenants need reporting-date classification and potentially separate accounts/reclassifications. Optional prior-month comparison does not replace required annual comparative information. [IAS 1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/).
- IFRS 15: invoice issuance triggers revenue/stock fulfillment. This can match delivery for simple completed sales, but no explicit performance-obligation/control-transfer, progress recognition or contract-liability/deposit workflow was found. Require correct event timing and contract assessment, especially advance billing, mixed contracts, services and returns. [IFRS 15](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/).
- IFRS 9 / IFRS 7: AR/AP balances do not prove expected-credit-loss measurement, financial-instrument classification, effective-interest calculations or risk disclosures. A fixed blanket bad-debt percentage is not automatically an adequate policy. [IFRS 9](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/), [IFRS 7](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-7-financial-instruments-disclosures/).
- IAS 16 / IAS 36 / IAS 38: custom fixed-asset accounts/manual journals exist, but no complete register, component/useful-life schedules, depreciation/amortization, impairment assessment or disposal/disclosure lifecycle was demonstrated. Evaluate only where such assets exist. [IAS 16](https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/), [IAS 36](https://www.ifrs.org/issued-standards/list-of-standards/ias-36-impairment-of-assets/), [IAS 38](https://www.ifrs.org/issued-standards/list-of-standards/ias-38-intangible-assets/).
- IFRS 16: a rent expense account is insufficient for leases requiring right-of-use assets/liabilities; assess available exemptions and relevant schedules/disclosures. [IFRS 16](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-16-leases/).
- IAS 12: a tax-disabled invoice pilot does not address current/deferred income-tax reporting. VAT, WHT and payroll taxes have separate legal/accounting questions; IAS 12 is about income taxes, not a synonym for VAT configuration. [IAS 12](https://www.ifrs.org/issued-standards/list-of-standards/ias-12-income-taxes/).
- IAS 19: operational payroll calculations and wages accounts are not evidence of all earned-benefit accruals, employer contributions or plan-specific measurement/disclosures. [IAS 19](https://www.ifrs.org/issued-standards/list-of-standards/ias-19-employee-benefits/).
- IAS 21: runtime explicitly limits reporting to single-currency NGN. Confirm actual functional currency and transaction scope. Foreign-currency transactions need appropriate exchange-rate/retranslation treatment; displaying NGN does not remove those requirements. [IAS 21](https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/).
- IAS 8, IAS 10, IAS 24 and IAS 37: add evidence for accounting policies/estimates and prior-period errors, subsequent events, related parties, provisions and contingencies. A reversal/audit trail alone is not the complete close/disclosure process. [IAS 8](https://www.ifrs.org/issued-standards/list-of-standards/ias-8-basis-of-preparation-of-financial-statements/), [IAS 10](https://www.ifrs.org/issued-standards/list-of-standards/ias-10-events-after-the-reporting-period/), [IAS 24](https://www.ifrs.org/issued-standards/list-of-standards/ias-24-related-party-disclosures/), [IAS 37](https://www.ifrs.org/issued-standards/list-of-standards/ias-37-provisions-contingent-liabilities-and-contingent-assets/).

Where material, also assess first-time IFRS adoption, groups/consolidation, business combinations, investments, fair-value measurement, investment property, agriculture, held-for-sale assets and sector-specific standards. This is an applicability checklist, not a claim every CACU business must implement every standard or account.

## Prioritized next work and sign-off

1. Accountant confirms entity framework, reporting periods, actual transaction scope and approved policies, including the IFRS 18 transition position.
2. Correct IAS 7 gross-flow netting and separate cash disclosures; add database-backed loan/interest, non-cash and restricted-deposit acceptance cases and reconcile exports.
3. Implement/review IAS 2 cost formulas, purchase-to-stock, NRV valuation/reversal and disclosure controls. Add source-supported golden fixtures.
4. Complete statement/notes/annual-comparative and maturity-classification controls. Apply only relevant recognition/measurement standards for actual businesses.
5. Prepare NG-2026.2 if account mappings must change; do not rewrite an adopted NG-2026.1 or delete historical postings. Account additions and mapping changes require compatibility, approval and migration review.
6. Run the complete financial fixtures, staging full-stack report acceptance and independent accountant review of actual statements and disclosures before any compliance claim. Keep commercial rules/email exclusions intact.

No production approval flag was changed and no postings were created. Do not sign an unqualified full-IFRS declaration from the earlier chart-mapping pass. Attach this gap assessment to the sign-off template and record unresolved conditions explicitly.
