# Daily books reconciliation (Doc 09 §6, TEST-402)

Every business on the native ledger is checked once a day at 02:30 Lagos time. This is part of Gate G2: the pilot needs two clean months of these checks per business.

## What is checked

From the same reports owners see, as of today in the business's timezone:

| Check | Rule |
|---|---|
| Trial balance | Debits equal credits |
| Customer balances | Open invoice balances equal the receivables control account |
| Supplier balances | Open bill balances equal the payables control account |
| Stock | Stock on hand at cost equals the inventory account |
| Cash | Closing cash in this month's cash-flow statement (from the cutover date in the first month) equals the ledger |

Doc 09 also lists an age check on the transfer clearing accounts. That check waits for the clearing workflow, which the pilot defers.

## How it runs

- `backend/tools/reconcile_books.py --apply --json`, run by `.github/workflows/books-reconciliation.yml`.
  - Off until the repository variable `CACU_BOOKS_RECONCILIATION_ENABLED` is `true`.
  - It needs the `CACU_DATABASE_URL` secret in the `billing-operations` environment.
  - A manual run without "apply" only counts the businesses.
- Each activated business is read as its first active owner (`ops.books_to_check`), so its row security applies. Nothing is posted or changed.
- Results go to `ops.reconciliation_runs`, which users and the runtime role can't read directly.
- A business with differences gets one email reminder a day to its owners through the billing notification outbox (kind `books_exception`). The wording names the checks, not figures.
- **When the run fails:** it fails, and GitHub notifies, if any business's books disagree or can't be checked. One business failing doesn't stop the others. The output is counts only.

## What happens next on a failure

Open the business's trial balance, cash-flow and control reports, find the posting or document behind the difference, and correct it with a reversal or adjusting entry, never by editing. The pilot's accountant reviewer signs off each correction.

## Not yet

- Pausing postings for a business whose trial balance doesn't balance (Doc 09 §6) still needs a person to decide.
- Showing the latest result on the owner's home screen.

## Tests

- `test_reports_postgres.py`: clean native books pass; a journal that bypasses an invoice is named as a receivables difference.
- `test_platform_billing_postgres.py`: only activated businesses are checked, as their owner; results are recorded; one reminder a day; the operator records results, keeps going after a failure and fails the run; reminder wording.
