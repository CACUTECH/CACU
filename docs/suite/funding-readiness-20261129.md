# Funding readiness, parts 1 and 2: the score, recommendations and history (E19 R3)

Doc 15 "Funding readiness assessment flow", "Funding readiness scoring" and FRA-001 to FRA-012. The owner chose, on 2026-11-25, to build it in three parts:

1. eligibility, the score and its explanation (done);
2. recommendations from a fixed library, and monthly history (FRA-002, FRA-003) (done, see below);
3. the lender pack, shared by an expiring link (FRA-006 to FRA-008).

All three stay behind a CACU switch that is off until gate G5.

## Off until gate G5

`accounting.funding_switch` starts off. Gate G5 needs three things first:

- the scores compared with lender partners' own assessments (FRA-010);
- a data protection impact assessment (FRA-012, CMP-08);
- counsel's view on credit-reporting rules once lenders use the pack (CMP-17).

Turning the switch on is a reviewed production change. Until then the screen shows "Funding readiness is not available yet." and nothing can be run.

## Plans (FRA-005)

The plans already had a `module.funding` entitlement:

| Plan | Entitlement | What it gives |
| --- | --- | --- |
| General | `score` | The score and its explanation |
| Oga | `improvement_plan` | Adds recommendations and history (part 2) |
| Chairman | `lender_pack` | Adds the pack and sharing (part 3) |

A business not yet billed gets everything, as with other plan features. `accounting.funding_access` returns the switch and the level, and the accounting API refuses when either is missing.

## Eligibility (FR-180)

A business can be assessed when all of these hold:

- **The books have run for 6 full months.** Activation needs an approved opening position, so this also covers that rule. The months are counted from the first full month of the books.
- **Nothing has waited more than 30 days:** no unmatched bank statement line, no transfer waiting to be confirmed, and no offline entry waiting for review.
- **The books checks pass:** the trial balance, and receivables, payables and stock against their control accounts. A failing check means the books don't agree with themselves, so it counts at any age.

Otherwise the owner sees each missing item and, while history is short, the earliest date the business can qualify.

The daily reconciliation run from the reconciliation branch is not on this branch yet. When it is, its open exceptions can join this list.

## The score

The score covers up to the last 12 full months, and at least 6. Each measure maps in a straight line from its worst value (0) to its best value (100), and is clipped at both ends. A dimension is the average of its measures, and the score is the weighted sum of the dimensions.

| Dimension | Weight | Measures, from the posted books |
| --- | --- | --- |
| D1 Record completeness and quality | 20% | Trading days with something posted (95% scores 100, 40% scores 0). Open exceptions (none scores 100, 10 scores 0): unmatched bank lines, transfers waiting over 7 days, offline entries to review, failing books checks |
| D2 Revenue consistency | 15% | Coefficient of variation of monthly operating revenue (0.15 scores 100, 0.80 scores 0). Needs 3 months and some revenue |
| D3 Revenue trend | 10% | The last 3 months against the 3 before (+15% scores 100, −30% scores 0). Needs 6 months |
| D4 Profitability | 20% | Net margin (15% scores 100, −10% scores 0). Months with a profit (10 of 12 scores 100, 3 of 12 scores 0) |
| D5 Cash-flow stability | 15% | Months with positive operating cash flow, from the cash-flow statement (80% scores 100, 30% scores 0). Lowest daily cash and bank balance, in days of average daily spending (30 days scores 100, 3 scores 0) |
| D6 Debt service capacity | 10% | Average monthly operating cash flow against average monthly loan repayments (2.0 scores 100, 1.0 scores 0) |
| D7 Receivables and concentration | 10% | Share of what customers owe that is over 60 days old (10% scores 100, 50% scores 0). The biggest customer's share of till sales and invoices (20% scores 100, 70% scores 0) |

The opening position is never counted as trading.

**Loan repayments** are debits to financing liability accounts, such as 2500 Loans and borrowings. The owner does not enter them.

**No loan repayments** follows Doc 15's rule for D6: 100 if trading brought cash in, otherwise 0.

**Missing data.** A measure the books can't give is shown as "Not enough in the books to work this out". A dimension with no measures at all is left out, its weight is shared among the rest, and the result says "based on 6 of 7 dimensions".

**Stock turnover** is shown for product and hybrid businesses but not scored. It is cost of sales divided by average month-end stock.

**Bands:**

| Score | Band | What the owner reads |
| --- | --- | --- |
| 80 to 100 | Strong | Your records and results are in good shape for a funding conversation. |
| 60 to 79 | Developing | A few areas to improve before approaching a lender. |
| 40 to 59 | Early | Build more consistent records and results first. |
| 0 to 39 | Not yet ready | Focus on the steps below for the next 3 months. |

No band says a business will or will not get a loan.

### Choices to check before release (FRA-010)

Doc 15 calls the thresholds starting points that must be validated. Three choices here are CACU's own, not Doc 15's:

- **D4 months with a profit:** Doc 15 gives no 0 point, so 3 of 12 months (25%) is assumed.
- **Trading days:** Monday to Saturday.
- **"Share of sales with receipts" (D1):** left out. Every till sale and paid invoice in CACU produces a receipt, so it would always be 100%.

## Versions (FRA-004)

`accounting.funding_model` holds each version's weights, thresholds and bands. Version `fra-1` holds the values above. A trigger refuses any change or deletion, so a new weight or threshold means a new version.

Each assessment in `accounting.funding_assessment` records:

- its model version;
- the period it covers;
- the score and band;
- the full explanation;
- who asked for it.

The API can add assessments but cannot change or remove them.

## Asking (FRA-003)

`POST /api/v1/businesses/{id}/funding-readiness/assessments` works out a new assessment.

- **Once a day:** a second request on the same day returns the first.
- **Who can ask:** owners, admins and editors who can see the ledger (`ledger.view`). Asking counts as a change, so it uses the write allowance. Viewers can see results but cannot ask.
- **Read-only businesses:** it still works while the business is read-only, as exports do. It writes nothing to the books.

`GET /api/v1/businesses/{id}/funding-readiness` returns:

- whether funding readiness is available;
- the plan level;
- eligibility;
- the latest assessment;
- whether one was made today.

## The screen

**Analytics › Funding readiness** (`/analytics/funding`) shows, always first: "This is an indicative self-assessment based on your CACU records. It is not a credit rating, credit report or offer of finance." (FRA-009)

Below the notice:

- **If the business can't be assessed yet:** what is missing, with the earliest date it can qualify.
- **If it can:** the score out of 100, the band and its words, the period, the number of dimensions used and the model version. Under each dimension come its score and share, and every measure with its value and both thresholds (FRA-001).
- **Always:** what the score cannot see. That is cash kept outside CACU, informal loans, unrecorded sales, a short history, and seasonal trading.

The score uses only the business's financial records, never anything about the owner as a person (FRA-011).

## Part 2: recommendations and history

### Recommendations (FRA-002)

Each dimension scoring below 60 gets up to three recommendations, weakest measure first. They come from a fixed library in `readiness.py`, one entry for each measure, filled in with the business's own figures. For example:

- "Confirm or clear the 14 pending transfers older than 7 days." (D1)
- "Collect the ₦420,000 owed for more than 60 days by 3 customers." (D7)

The D1 open-exceptions entry can give several steps: bank lines, transfers, offline entries and each failing books check. A measure that could not be worked out gets no recommendation. No entry promises finance.

Recommendations are worked out and stored with every assessment, whatever the plan. The API removes them for the General plan, so a business that upgrades sees them on its past assessments too.

### The monthly assessment (FR-185, FRA-003)

CACU works out one assessment a month (`kind = 'monthly'`) for each business that qualifies. It sits alongside the owner's own requests, which stay at most once a day.

- **At most once a month:** a unique index allows one monthly assessment per calendar month. The month is counted in the business's own time zone.
- **Who is due:** `accounting.funding_monthly_queue()` (security definer, runtime only) lists each business that has all of these:
  - the switch on;
  - a plan that includes funding readiness;
  - active books;
  - not closed;
  - no monthly assessment yet this month.

  For each business it gives an active owner to act for.
- **How it runs:** `python -m tools.run_funding_monthly --apply` reads each business's books through `library_transaction` as a server job (`level='system'`), with that owner's access and `ledger.view`. A business that does not qualify yet (409) is counted as `not_eligible` and tried again the next day. Other failures are counted as `failed`, and the tool then exits 1. The report has counts only, never figures.
- **Schedule:** `.github/workflows/funding-readiness.yml` runs daily at 03:40 UTC. It is off until the repository variable `CACU_FUNDING_MONTHLY_ENABLED` is `true`, and the queue is empty while the switch is off. A manual run is a dry run unless "apply" is ticked.
- **Writing:** the monthly assessment writes nothing to the books. Its `requested_by` is empty.

### History (FRA-003, FRA-005)

On the Oga and Chairman plans:

- `GET …/funding-readiness` also returns `history`: the last 24 assessments, newest first, each with its kind, date, score, band, model version and period;
- `GET …/funding-readiness/assessments/{id}` returns one past assessment in full, as it was worked out.

On the General plan, `history` is `null` and the single-assessment endpoint answers 403.

The screen lists past assessments with the change in score from the one before, marked "Monthly" or "You asked". Opening one shows it in full until "Back to the latest". The General plan sees a line saying what the Oga and Chairman plans add.

## Not yet

- Part 3: the lender pack and consented sharing.
- Gate G5, as above.
