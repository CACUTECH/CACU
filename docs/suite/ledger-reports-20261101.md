# R1 Trial balance, general ledger and first-period cash flow - implementation review

## Scope

This item covers:
- FR-143, the trial balance
- FR-140, the general ledger
- ACC-013, which says reports must reconcile
- the cash-flow reviewer point left open by Turn on the books

It implements Doc 11's `GET /reports/general-ledger` and `GET /reports/trial-balance`. It adds no migration.

## Change

- **Trial balance** (`cacu/accounting/reports.py`, `/accounting/trial-balance`):
  - It shows every account's balance at the end of the chosen date, ordered by account code, with zero balances left out.
  - It is labelled "Management statements, not reviewed", accrual basis, NGN, with the time it was generated (Doc 09 presentation rules).
  - The ACC-013 checks run on any report up to today. Each one compares a control account with its subledger:
    - receivables against open invoice balances
    - payables against open bill balances
    - inventory against stock on hand at cost
    - debits against credits
  - A failed check is listed at the top, before the figures, as Doc 09 requires. For an earlier date the checks are skipped and the page says so, because subledgers only hold today's position.
  - Each account links to its general ledger entries for the year to date.
- **General ledger** (`/accounting/general-ledger`): one account over a period.
  - It shows the opening balance, each entry with its date, number, description, the other account and a running balance, then the period totals and closing balance.
  - It pages 100 entries at a time, and the running balance carries across pages.
  - An account from another business returns not found.
- **First-period cash flow:**
  - The approved opening position is dated on the books' start date. Until now, a cash-flow statement covering that date reported the opening balances as cash flows.
  - Now the opening journal and the per-customer and per-supplier opening entries count as the position brought in. Their cash is opening cash, and their other lines are not flows of the period. They are identified from the activation evidence.
  - Net profit is unaffected, because the opening entries have no income or expense lines.

## For the reviewer

1. **The stock check uses each item's stored cost** (quantity × cost price). This matches how stock is valued today. Weighted-average cost (FR-086) will change it.
2. **There are no comparative periods yet.** Doc 09 asks for prior-period and same-period-last-year comparatives, and PDF and Excel exports, on every statement. These are left for the statements work (FR-140 to FR-148).

## Verification

- `test_reports_postgres.py`, 6 cases on a business turned on from an approved opening position:
  - **First-period cash flow.** It opens at 425,000 with no flows. After an expense it shows only that expense, and it reconciles.
  - **Trial balance.** It balances, with every control check passing after an expense and a stock write-off. The balances are exact by code, zero balances are left out, and lines are ordered by code.
  - **Control exception.** A journal posted straight to receivables is listed as a 5,000 receivables difference.
  - **Earlier dates.** A date before the start is empty and skips the checks.
  - **General ledger.** Opening, running and closing balances are correct, including on page 2 and for a later period. An account from another business is refused.
- Browser component tests:
  - **Trial balance:** the labels, the exception shown above the table, totals and entry links, at phone width.
  - **General ledger:** balances and paging. Paging keeps the report on screen even after the filters are edited.

## Release steps

Merge after the expenses, reversals and stock approval item. There is no migration. Try it on staging with a turned-on business before the pilot (G2).
