# Month close (Doc 10 E14 R3 part 1, FR-135)

**Where it comes from in the specification:**
- **Doc 09, "Periods, close, reconciliation and controls":** months are the posting periods. Closing needs `ledger.post` and `ledger.approve`; reopening needs the Owner and is audited. The month-end checklist has 8 steps.
- **Doc 07:** posting rejects dates in a closed period. Explicit close and lock is new.
- **Doc 11 R3:** `POST /periods/{month}/close` and `POST /periods/{month}/reopen`.

**Owner decisions of 17 November 2026:**
- Closing is **refused** while the trial balance does not balance, or receivables, payables or stock differ from their control accounts.
- Every other step is a **warning** the closer ticks as done or explains (at least 5 characters). The answers are kept with the close.

## What happens

**Accounting › Month Close** (`/accounting/periods`):
- Lists every month since the books started, newest first, with its status.
- Shows the checklist for the next month to close.
- **Close [month]** is disabled while any blocking step fails.
- The Owner can **reopen** the latest closed month, giving a reason.

**Rules:**
- Months close in order from the month the books started, and only once they have ended.
- Only the latest closed month can be reopened, so the closed months are always one unbroken run.
- A reopened month can be closed again, with a new checklist.

## The checklist

| Step | Kind | How it is checked |
| --- | --- | --- |
| Trial balance balances at the end of the month | Blocking | Trial balance at the month's last day |
| Customer balances on open invoices match the receivables account | Blocking | ACC-013 control check, on today's books |
| Supplier balances on open bills match the payables account | Blocking | Same |
| Stock on hand at cost matches the inventory account | Blocking | Same |
| No transfers waiting for confirmation more than 7 days | Warning | Pending transfers older than 7 days |
| Card and online payments clearing is settled | Warning | Balance on the gateway clearing account at the month's end |
| Bank and cash balances agree with statements and cash count | Warning, always answered | Manual until bank reconciliation is built |
| Stock counted or reviewed | Warning, answered if the business tracks stock | Manual until stock counts are built |
| Bills and costs for the month recorded | Warning, always answered | Manual (accruals are not built yet) |
| Statements reviewed by the Owner or an Admin | Warning, always answered | Manual |

**Why the control checks use today's books:** the subledgers (open invoices, open bills, stock on hand) hold today's position. Every later posting goes through a document that moves both the subledger and its control account, so books that agree today agreed at the month's end too.

## How a closed month is enforced

- **The database:** a `BEFORE INSERT` trigger on `accounting.ledger` (`ledger_month_open`) refuses any line dated in a closed month (`ACCOUNTING_MONTH_CLOSED`), whichever route wrote it.
- **The API:** `library_transaction` turns that refusal into "This month is closed. Date it in an open month, or ask the owner to reopen the month." The stock, valuation and offline-sale checks ask the same question first, so the person sees the reason before anything is attempted.
- **The record:** `accounting.period_close` keeps who closed each month, when, the checklist and the answers. Every close and reopen is also written to `accounting.audit_event`.
- **Corrections:** a mistake found in a closed month is corrected in the next open month (Doc 03 FR-113), or the Owner reopens the month.

## Tests

- `backend/tests/test_month_close_postgres.py`:
  - Order, ended months and answered warnings.
  - The answers are kept.
  - Refused when stock differs from its account.
  - Owner-only reopening of the latest month, with a reason.
  - The ledger refuses a closed month, and the API's plain message.
- `src/tests/security/month-close-ui.test.tsx`: answering warnings, closing and reopening, a blocked close, and a refusal from the books.

## Year-end close (R4, owner decision of 27 November 2026)

**Closing a year.** Once every month of a financial year is closed, the Owner can close the year (**Years** on the Month Close page). Then:

- none of its months can be reopened until the year is;
- the statement of financial position shows the profit of closed years as **Retained earnings from closed years**, and only what came after as **Profit for the year**.

**Rules:**

- **When:** a year closes only once it has ended, and years close in order.
- **Which year end:** years end on the business's year-end month (set on the Income Tax Estimate page; 31 December unless set).
- **Reopening:** the Owner can reopen only the latest closed year, with a reason. The closing is kept, marked reopened.
- **The record:** `accounting.year_close`. API: `POST /periods/years/{year}/close` and `POST /periods/years/{year}/reopen`.

**Why there is no closing journal.** The reports reconcile their profit with the accounting library's own income statement. A closing entry would wipe the year's income and expenses there and break that check, notably in the cash flow statement. So closing a year locks it and changes how the balance sheet presents profit, and posts nothing.
