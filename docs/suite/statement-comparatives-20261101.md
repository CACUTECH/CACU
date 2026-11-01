# R1 Statements with comparatives and exports - implementation review

## Scope

This item covers FR-140 to FR-142 and Doc 09's presentation rules:
- comparatives: the prior period and the same period last year
- every statement shows the business, period, currency, basis, tier label and generation time
- reconciliation exceptions appear at the top
- PDF and Excel exports carry the same labels and exceptions

It adds `GET /reports/statements` and no migration.

## Change

- **`statements()`** (`cacu/accounting/reports.py`) returns, for a period and an optional comparison (`compare=prior` or `last_year`):
  - **Statement of profit or loss.** It is split into revenue, cost of sales, gross profit, operating expenses, other income, other expenses and net profit, account by account.
  - **Statement of financial position** at the end of each period. Assets and liabilities are split into current and non-current, alongside equity. The books are not closed at year end yet, so all profit to date appears as a separate equity line, "Profit to date not yet closed to retained earnings".
  - **Exceptions** for either period: debits differing from credits, or assets not equalling liabilities plus equity.
  - **Labels:** tier, basis, currency and generation time.
- **Reports page.** The Income Statement and Balance Sheet tabs now show the full statements by account, not two or three totals. Each has a period picker, a comparison choice ("The period before" or "Same period last year"), the labels and the business name, exceptions above the figures, and Excel and PDF exports. The exports are built from the same rows as the screen.
- **Cash-flow statement:** gains "Same period last year" as well as the period before, and the tier label on screen and in its PDF.
- **Fixes:**
  - Report amounts could show a negative zero ("-0.00").
  - The reports page displayed garbled characters ("Loading statementÃ¢â‚¬Â¦").

## For the reviewer

1. The section rules come from the ledger account types:
   - cost of sales is `DIRECT_EXPENSE`, which includes stock write-offs (5100)
   - interest (7000) is under other expenses
   - contra assets are shown inside non-current assets as negative amounts
2. With no year-end close (period close is R3), profit is shown in equity as one cumulative line, not split into retained earnings and profit for the year.
3. The statement of changes in equity (FR-143 in Doc 09's set) is not built yet.

## Verification

- `test_reports_postgres.py`, 1 new case on a turned-on business with an expense and a credit sale:
  - revenue 65,000, cost of sales 50,000, gross profit 15,000, operating expenses 15,000, net profit 0
  - current assets 988,601.50, liabilities 350,000.50, equity 638,601.00, difference 0
  - the comparison period (the day before the books started) is all zero with no exceptions
  - "last year" shifts the year, and an unknown comparison is refused
- Browser component tests:
  - **Statements:** period and comparison columns, labels, an exception above the figures, and the right calls for each tab, at phone width.
  - **Excel export:** it contains the labels, the exception and the amounts.
  - **Cash flow:** comparison with the period before and with the same period last year.

## Release steps

Merge after chart edits. There is no migration.
