# Profitability (Doc 18 R3 "E15 rest"; Doc 09 statement set)

**Where it comes from in the specification:**
- **Doc 09's statement set** includes "management profitability by product, service, outlet and job".
- **Doc 12** lists Reports › Profitability.
- **Job profit** (Doc 10 "Empire", today's Chairman) already exists on each job. This report brings jobs together.

No owner decision was needed.

## What happens

**Analytics › Profitability** (`/analytics/profitability`), for a chosen period (this month by default):
- **Products and services:**
  - **Sold:** the quantity sold, less what came back.
  - **Revenue:** till sales and invoices dated in the period, less refunds and credit notes made in it, net of VAT where VAT was charged.
  - **Cost:** what the stock that left for those sales, invoices and jobs cost when it left, less the cost of goods that came back.
  - **Profit and margin:** shown for each, highest profit first, with losses in red. Services have no stock cost.
- **Outlets:** till sales grouped by the outlet their stock left from. Invoices, and services sold with no stock movement, appear as "Invoices and services".
- **Jobs** (Chairman, with job costing): each job completed in the period, with revenue, materials, labour at each staff member's cost rate, and profit. It flags labour entries with no cost rate.
- **A summary line** gives total revenue, cost, profit and margin. It is labelled "Management figures from your books, not reviewed".

## How the figures are worked out

- **Dates:** a sale or invoice uses the date of its posting, and a refund or credit note the date it was posted. Stock cost uses the time the stock left or came back.
- **VAT:** a till sale or invoice that charged VAT with prices including it counts each line's value less its VAT share. Refunds and credit notes on it use the same share. Invoices priced before VAT already show net line values.
- **Cost:** comes from `accounting.stock_event`, the record of each stock movement, for the sale, invoice, job, refund or credit note that caused it. Receipts from suppliers, adjustments, counts and transfers aren't sales, so they aren't counted here; they show in the statements.
- **Permission:** the report needs `ledger.view`.

**Limits:**
- An invoice can't be tied to an outlet, so outlet figures cover till sales.
- A job's materials count in the period the job was completed, and its invoice revenue in the period it was invoiced. Across a month end, the two can fall in different periods.

## Tests

- `backend/tests/test_profitability_postgres.py`:
  - Revenue, cost, profit and margin per item from a till sale and an invoice.
  - Order by profit, and the label.
  - A refund taking back revenue and cost.
  - Invalid dates refused.
  - VAT not counted as revenue.
  - Outlet totals.
- `src/tests/security/profitability-ui.test.tsx`: the summary, losses marked, the outlet and job tabs, and jobs hidden below Chairman.

## Statement of changes in equity

The Reports screen has a fourth tab, Changes in Equity. For each equity account it shows the balance at the start of the period, the movements in the period, and the balance at the end. The profit not yet closed to retained earnings appears as its own line, so the closing total agrees with the equity on the statement of financial position. There is no comparison column, because the statement already runs from the opening balance to the closing one. It is built in `statements()` (`backend/cacu/accounting/reports.py`) from the same posted balances as the other statements. It carries the same label and exceptions.

## KPI dashboard

`/analytics/kpi` replaces the "not available yet" page. `GET /reports/kpis?start_date&end_date` (ledger.view) returns two groups of figures:

- **For the period, against the period of the same length before it:** revenue, gross profit and margin, operating expenses, net profit, the number of till sales and invoices, and the average sale. Opening balances are not counted as sales.
- **At the period's end:** cash and bank, what customers owe and how much of it is overdue, what is owed to suppliers, and stock at cost.

Every figure comes from the posted books through `statements()` and the ageing reports. Nothing is estimated. A change is shown in green when it is good news, so when spending rises it shows in red. There is no percentage when the earlier period was zero. When the books do not reconcile, the figures carry a warning. They are labelled "Management statements, not reviewed".
