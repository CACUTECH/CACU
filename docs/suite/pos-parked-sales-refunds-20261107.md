# POS, part 3: parked sales and refunds (Doc 10, PR-16, FR-044)

Parked sales let the till set a cart aside and finish it later. Refunds take items back from a paid sale, return the money, and put resaleable goods back in stock. Refunds follow an approval rule the owner sets.

Refunds need the business's books turned on (native accounting). Parked sales work either way, because nothing is posted.

## Parked sales

- **Park sale** (under the cart) saves the cart with an optional name, for example "Ada, blue cap", and empties the till. Nothing is recorded in the books.
- **Parked sales (n)** lists every parked cart in the business.
  - **Resume** loads a parked cart back into the till, but only when the till's cart is empty.
  - **Discard** deletes it.
- **Prices and stock** are read again from the catalogue on resume. Items no longer for sale, or out of stock, are left out and the till says so. Discounts are checked again at checkout.
- **Who can use them:** anyone with `sales.create` can park, see, resume or discard a parked cart. A parked cart can't be edited, only resumed or discarded.
  - Taking one removes it first. If two tills try at once, the second is told it was already taken.
- **Who parked it** is set by the database to the signed-in person and can't be supplied.

## Refunds

Start from **Sales and refunds** (`/pos/sales`, linked from the till) or from a receipt.

- **Choosing what to refund:** items and quantities come from the original sale. A refund can never be more than was sold less earlier refunds; refunds still waiting for approval count too.
- **Amount:** the line's net price, after any discount. A partial refund shares what's left on the line by unit, rounded to the kobo. The last units take whatever remains, so a line always refunds to exactly what was paid.
- **Back to stock:** for tracked products only, ticked by default.
  - Goods return at the cost they left at. That includes products on IFRS valuation, which use their valuation records.
  - Untick it for damaged goods. Their cost stays in cost of sales.
  - If the sale was oversold (BR-022), units that never came off recorded stock aren't returned.
- **How the money goes back:** by the original method by default, cash from the till or a bank transfer. A split sale defaults to cash. A transfer refund needs the bank account it's paid from; the approver can choose it.
- **Posting (PR-16):**
  - Debit revenue, credit cash or the bank. This is a new internal posting kind, `sale_refund`, which the generic postings route can't post.
  - Restocked goods: debit inventory, credit cost of sales.
  - The sale's status becomes `refunded` and its `refunded_total` grows. The receipt shows "Refunded".
- **Refunds that can't be made:**
  - A transfer sale still awaiting confirmation: confirm it or mark it not received first.
  - A reversed sale.
  - Credit sales: these are invoices, corrected through invoice credit notes.
- **Retries:** each refund is replay-safe under its request key, so a retried request never refunds twice.

### Approval (FR-044, the owner's rule)

| Who asks | Refund | What happens |
|---|---|---|
| Someone with `sales.approve` (Owner, Admin, Sales manager) | Up to the owner's refund limit (no limit unless set) | Paid at once |
| Someone with `sales.approve` | Above the limit | Waits for a second approver |
| Anyone else with `sales.edit` (for example Cashier) | Any amount | Waits for approval |

- Waiting refunds appear on **Daily reconciliation › Refunds**, where an approver approves and pays, or rejects with a reason.
- With separation of duties on (the business's approval rules, on by default), nobody approves their own refund. Requesters can withdraw their own refund.
- The owner sets the refund limit on the same card. Only the owner can change it.
- A refund is decided once (database trigger).
- Daily reconciliation also shows the day's refunds by method.

## Database

Migration `20261107110000_pos_parked_sales_and_refunds.sql`:
- `public.parked_sales`:
  - Row security: read, insert and delete with `sales.create`; no updates.
  - A trigger sets `created_by` to the signed-in person.
- `public.transactions.refunded_total`.
- `accounting.sales_policy.refund_threshold`.
- `accounting.sale_refund`: decided once. `accounting.sale_refund_line`: one row per sale line, with whether it goes back to stock.

The migration adds no new SECURITY DEFINER functions. The stamp trigger runs as the caller.

## API

- `GET /sales?day=`: the day's till sales (`sales.view`).
- `GET /sales/{id}/refundable`: what can still be refunded on each line, the default method, the limit, and whether the caller can approve.
- `POST /sales/{id}/refunds` (`sales.edit`): takes `lines` (`line_id`, `quantity`, `restock`), `method` (Cash or Transfer), `bank_account_id`, `reason` and `request_key`.
- `GET /refunds?status=`.
- `POST /refunds/{id}/approve` (`sales.approve`).
- `POST /refunds/{id}/reject` (`sales.edit`; rejecting someone else's needs `sales.approve`).
- `POST /sales/refund-policy` (Owner).
- Existing endpoints gained fields:
  - `GET /sales/options` now includes `refund_threshold`.
  - The receipt includes `refunded_total`.
  - Daily reconciliation includes `refunds` and `refunds_pending`.

## Code change elsewhere

The transfer "not received" reversal (part 1) now uses the same return-to-stock code as refunds.

## Tests

- `test_pos_refunds_postgres.py` (4 cases, on a business started from the real chart):
  - a partial then a full refund at the net price, with goods back at cost, a retried request refunded once, and over-refunds refused;
  - a cashier's transfer refund waiting, holding its units and paid from a bank by an admin without restocking, plus the day's refund totals;
  - the owner's limit and separation of duties: a rejection needs a reason, and a withdrawal frees the units;
  - parked sales visible to people who sell, hidden from an auditor, and never updated.
- Jest:
  - `pos-refunds-ui`: refund amounts match the server's rounding; the cashier and approver dialogs; a retry keeps its request key; parking and resuming on the till;
  - `daily-reconciliation-ui`: approving and rejecting refunds, withdrawing your own, and the owner's limit.
- The OpenAPI contract is regenerated.

## Next

- POS part 4: cashier shifts with float, pay-ins and pay-outs, and over/short (PR-22). Done; see `pos-cashier-shifts-20261107.md`.
- Not yet built:
  - discounts on credit sales;
  - email receipts and public receipt links;
  - card payments.
