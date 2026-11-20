# POS, part 1: transfers wait for confirmation (BL-024)

BR-010, Doc 09 PR-03 to PR-05 and ACC-009, Doc 10 daily reconciliation, Doc 11 R1 transfer endpoints. Release test TEST-107.

Before this change, a transfer sale or invoice payment debited the bank account the moment it was recorded, so a transfer that never arrived still counted as money in the bank. Now only cash counts as received at once.

## What happens now

| Event | Posting | Records |
|---|---|---|
| Transfer sale at POS (PR-03) | Debit Transfers awaiting confirmation (1020), credit revenue; cost of sales and stock as before | Sale status `pending_payment`; a pending transfer |
| Transfer payment against an invoice | Nothing yet | A pending transfer; the invoice stays outstanding. A second transfer cannot take the total waiting above what is owed |
| Owner confirms a sale's transfer (PR-04) | Debit the chosen bank, credit 1020 | Sale `completed` |
| Owner confirms an invoice payment | The receipt posts into the chosen bank and clears the invoice by that amount | Payment recorded as a transfer |
| Sale's transfer not received (PR-05) | Debit revenue, credit 1020; the goods return to stock at the cost they left at (debit inventory, credit cost of sales; adopted valuations get a return event) | Sale `reversed` |
| Invoice payment not received | Nothing | The invoice stays outstanding |

- The cashier no longer has to pick a bank account for a transfer. They may name the one they expect, which is offered first when confirming. The owner picks the actual account on confirmation.
- Each transfer is decided once. A decision is safe to retry with the same request key. A second, different decision is refused.
- Confirmations and reversals post on the day they are decided, in the business time zone.
- The two new posting kinds (`transfer_confirmation`, `transfer_not_received`) are posted only by these workflows. The generic postings route refuses them, and they are not offered for journal reversal.

## Who can do it

- See waiting transfers and the daily summary: `banking.view`. Owner, Admin, Accountant, Bookkeeper, Auditor and Editor (legacy) can; Cashier cannot.
- Confirm or mark not received: `banking.post`. Owner, Admin and Accountant.
- Confirming is allowed while the workspace is read-only, like recording other payments received.

## Screens

- **POS checkout and invoice payments:** for a transfer, the bank account is optional ("Not sure yet: choose when confirming"), and the form explains that transfers wait for confirmation. A transfer sale is reported as "Sale recorded: transfer awaiting confirmation".
- **Daily reconciliation** (`/reconciliation/daily`, in the main menu): the day's sales by method, showing how much is still awaiting confirmation and how much was reversed. Below that, every waiting transfer with how long it has waited (two days or more is flagged), each with Confirm (choose the bank) and Not received (a reason is required; the screen says the sale will be reversed and the goods returned to stock).

## Database

Migration `20261107090000_transfer_clearing.sql`:
- `accounting.pending_transfer`, under row security for the runtime. Only the decision columns can change, and only once.
- The sale status check gains `pending_payment` and `reversed` (Doc 10 sale states).

## API

- `GET /transfers?status=pending|confirmed|not_received`
- `POST /transfers/{id}/confirm` with `{request_key, bank_account_id}`
- `POST /transfers/{id}/not-received` with `{request_key, note}`
- `GET /reconciliation/daily?day=YYYY-MM-DD`

## Tests

- `test_release_gate_postgres.py::test_107…` on a business started from the real chart: two transfer sales; one confirmed, one not received. Checks bank, clearing, revenue, cost of sales, inventory and stock; that the trial balance and cash flow reconcile; that a decision cannot be made twice; and that the generic route cannot post a confirmation.
- `test_library_postgres.py`: a transfer receipt is held, the invoice stays outstanding, over-allocation against waiting transfers is refused, then it posts on confirmation; a transfer sale lands in clearing with status `pending_payment`.
- `test_transfers_api_postgres.py`: who can see and decide transfers.
- Jest `daily-reconciliation-ui.test.tsx` and the updated payment-form tests; Playwright `collection.spec.tsx`.

## Not in this part

- Card payments (PR-14, PR-15) wait for the terminal decision (Doc 10 open question).
- Cash received and change, credit and split sales, discounts and the overselling setting are POS part 2. Parked sales and refunds are part 3. Shifts are part 4.
- Before applying to production: existing businesses that adopted the NG-2026.1 chart already have account 1020 (Transfers awaiting confirmation). A business without it is told to set it up before taking transfers.
