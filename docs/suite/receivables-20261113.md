# Receivables: payments for several invoices, advances, ageing and statements (Doc 10 E11)

Doc 18 puts E11 "multi-receipt, ageing" in R2. Doc 09 ACC-006, PR-10 and PR-11 set the accounting; Doc 11 lists the multi-invoice receipt, the customer statement and the ageing report.

## Receiving a payment (Invoices › Receive payment)

- **Choosing the invoices:** the person chooses the customer and enters what was received. CACU splits it across that customer's open invoices, oldest due date first (the issue date when there is no due date). Any invoice's part can be changed; "Split oldest first again" restores the split.
- **Limits on a part:** no part can be more than is still owed on its invoice, less transfers already waiting for confirmation on it.
- **Money paid beyond the split** is kept as the customer's advance. It is shown as "Kept as advance" before the payment is recorded.
- **Cash** posts at once: each invoice part as its own receipt into the till (the invoice turns Paid when nothing is left), and any advance as Dr the till, Cr Customer deposits and advances (2100, PR-10).
- **A transfer** waits on Daily reconciliation as one transfer, of the kind "customer payment" (BR-010). Nothing posts and the invoices stay owed meanwhile, but each part counts as waiting on its invoice, so the same debt cannot be paid twice.
  - **Confirming** posts every part and the advance into the chosen bank. If an invoice no longer needs its part (a credit note meanwhile), that part becomes advance, because the money has arrived.
  - **Not received** drops it. Nothing is posted.
- **Single-invoice receipts** (Mark as Paid) now also refuse a cash amount above what is owed less waiting transfers.
- **The first advance** adds Customer deposits and advances to the chart, so only an Owner or Admin can record it. Booking deposits use the same account.
- **Retries:** a payment is replay-safe under its request key. An unconfirmed answer keeps the same details for a retry.

## Using or handing back an advance

- **Use customer advance** (invoice menu, `invoices.post`): applies part of the advance to an invoice. It posts Dr Customer deposits, Cr the customer's receivable, allocated to the invoice (PR-11). The amount can be at most the advance held and at most what is still owed.
- **Hand back the advance** (customer statement; Owners and Admins only): pays it back from the till or a bank, with a reason. It posts Dr Customer deposits, Cr the till or the bank.
- **Advance records** (`accounting.customer_advance`) are permanent. A customer's balance can never go below zero.

## Customer statement (`/invoices/statement`)

- **What it shows:** the period's invoices, payments, credit notes, booking deposits applied, advances received and advances handed back, with the balance brought forward and a running balance. It can be printed or saved as a PDF.
- **Applying an advance** does not change the balance, because the customer had already paid that money.
- **Transfers still waiting** for confirmation are not on the statement yet.

## Ageing (`/analytics/aging-reports`)

- **Two views:** "Customers owe you" and "You owe suppliers", as at any date up to today, from the posted books.
- **What counts:** documents issued by that date, less what cleared them by that date, grouped by days past due:
  - Not yet due;
  - 1 to 30 days;
  - 31 to 60 days;
  - 61 to 90 days;
  - Over 90 days.
- **Opening balances** from the books' start are included.
- **Customer rows** also show the advance they hold, link to their statement, and expand to show each document.
- **Download CSV:** exports the table. The report is labelled as a management report, not reviewed.

## Database

Migration `20261113090000_customer_receipts.sql`:

- **`accounting.customer_receipt`:** each payment, its split, its advance and its status. A transfer is decided once, and its details never change.
- **`accounting.customer_advance`:** each advance received, applied or handed back. Rows are permanent, and a customer's balance never goes below zero.
- **`pending_transfer`:** gains the source type `customer_receipt`.
- **Security:** row-level security for `cacu_runtime` on both tables. There are no new definer functions.

The posting engine gains the internal kind `customer_advance` (Dr the till or a reviewed bank, Cr Customer deposits and advances).

## API

| Method and path | Permission |
|---|---|
| `GET /customers/{id}/open-items` | `invoices.view` |
| `POST /customer-receipts` | `invoices.post`; allowed while the workspace is read-only, like receipts |
| `POST /invoices/{id}/apply-advance` | `invoices.post` |
| `POST /customers/{id}/advance-refund` | `invoices.post`; Owners and Admins only |
| `GET /customers/{id}/statement?start_date&end_date` | `invoices.view` |
| `GET /reports/ageing?type=receivables\|payables&as_of=` | `invoices.view` for receivables; `expenses.view` for payables, as for bills |

## Tests

- **`test_customer_receipts_postgres.py` (3):**
  - One payment clears the opening balance and two invoices, with the rest kept as advance. Only an Owner or Admin adds the advances account; over-owed, over-paid and other-customer parts are refused; a retry records once; the till, receivables and 2100 move by the right amounts.
  - The advance pays the rest of an invoice and refuses more than is owed or held. Handing it back is Owners and Admins only, and advance records are permanent. The statement's balance is correct, and the books balance.
  - A transfer for two invoices waits as one: its parts block a cash receipt and a second payment, it appears as a customer payment on Daily reconciliation, and confirming posts both parts and the advance into the bank. "Not received" leaves the invoice owed.
  - Ageing: buckets by days past due, as at a date, opening balances, payables, and refusal of other report types.
- **Jest `receivables-ui` (4):**
  - The oldest-first split, editing the split, refusing a part above what is owed, and the advance shown.
  - A transfer needs its bank, and an unconfirmed answer locks the details for a retry.
  - Applying an advance defaults to the smaller of the advance held and the amount owed.
  - Ageing rows, document detail, the statement link, and switching to suppliers.
- **Honest-state tests:** the TEST-407 checks no longer list the ageing page.
