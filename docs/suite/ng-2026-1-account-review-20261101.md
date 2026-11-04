# NG-2026.1 standard-account review - 1 November 2026

## Decision

Technical mapping checks passed for the checked-in template: Product 28, Hybrid 28, Service 24 accounts. This is an engineering review, not professional accountant approval, an audit opinion, IFRS compliance certification or authorization to post. The hosted template was checked read-only and remains pending_review, reviewed_at null. No database status, reviewer identity, business balances or posting settings were changed.

The user requested review and approval. An AI technical review must not be recorded as sign-off by CACU's qualified accountant. Owner/Admin approval of a business's opening balances is a separate control from the platform chart accountant review (DEP-02).

## Reviewed material

Source: supabase/migrations/20261031100000_default_chart_of_accounts.sql, cacu/accounting/chart.py, catalog.py, workflows.py, activation.py and reports.py; existing default-chart implementation notes. See [account-by-account review sheet](ng-2026-1-account-review-20261101.csv). It contains all 80 mode-specific mappings and blank accountant decisions/notes, not tenant data.

Validated using the existing chart.validate function: source IDs unique; mapped library types recognized; valid cash-flow sections; cash/bank accounts are BANK in the cash section; required cash/revenue/equity purposes exist; inventory and COGS exist for Product/Hybrid; single-use posting purposes are not duplicated. These checks do not prove complete accounting coverage or every end-to-end posting rule. Existing tests were inspected, not newly run against a hosted business.

## Items requiring explicit accountant decisions

| Area | Current behavior found | Decision needed |
| --- | --- | --- |
| 3900 Opening balance equity | Purpose equity is also used by catalog.py when adding initial stock to a new item after cutover. Activation separately uses 3900 to clear customer/supplier opening documents and reconciles the approved opening journal. | Confirm which events may use opening equity; distinguish approved brought-forward stock or owner contributions from ordinary purchases and corrections. Do not approve unexplained ongoing plugs. |
| Hybrid revenue | Both Product and Hybrid sales currently select the revenue purpose on 4000 Sales of goods. 4100 Service income exists, but only Service-only mode assigns it the revenue purpose. | Approve combined Hybrid revenue as a documented pilot limitation or require separate goods/service routing before release. |
| Loans | 2500 Loans and borrowings is NON_CURRENT_LIABILITY. | Confirm whether pilot businesses may have short-term/current loan portions, and the required account/maturity mapping. |
| Transfers | 1020 Transfers awaiting confirmation exists; the earlier design notes defer use until the transfer-clearing contract is approved. | Confirm the actual confirmation workflow and statements treatment before claiming all transfers pass through clearing. |
| Inventory | Product/Hybrid have inventory, COGS and write-off accounts; accounting coverage depends on actual posting routes and costing policy. | Review the purchase, sale, return, adjustment and stock valuation fixtures, not just names or mappings. IAS 2 relates inventory expense recognition to related revenue and addresses write-downs. |
| Cash flow | Opening-position transactions are explicitly brought forward and excluded from period movements; cash-flow code removes non-cash investing/financing movements. 7000 Interest expense is operating. | Review worked first-period/non-cash and interest/loan examples and choose the applicable reporting policy. |
| Coverage | VAT/WHT, deposits, payroll liabilities and fixed-asset accounts are deliberately deferred. | Limit approval to the supported R1 NGN scope; do not imply tax, statutory payroll or full statutory-reporting readiness. |

Authoritative context for the accountant: [IAS 2 inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/) and [IAS 7 cash flows](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/). These references are not a claim that this template or software complies with every applicable standard.

## Required sign-off and recording

The qualified reviewer should provide their name/organization, reviewed version NG-2026.1, dated written decision, approved pilot scope, any conditions/exclusions, and decisions for the items above. Each business's Owner/Admin then approves its actual opening balances, mappings and accounting policies before starting books. Do not invent the reviewer, date or evidence, and do not use the staging-unreviewed switch to activate production.

If accounts/mappings need changes, create a new template version (for example NG-2026.2) with a reviewed migration; do not rewrite an adopted version. If the existing version is accepted without changes, prepare the status/reviewed_by/reviewed_at migration from genuine sign-off evidence, review it on staging, then have the authorized operator release it. No automatic production approval was performed by this review.

Source migration SHA-256: abc188e4cf0097f1208afcd30db8569e15a7efe13a657cda8edc7c862c15f7d3
