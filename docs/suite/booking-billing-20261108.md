# Bookings, part 3: billing a completed booking (Doc 10, PR-13, PR-11)

A completed booking is billed once, either at the till or by invoice. A deposit held for the booking is taken off the bill, so the customer pays only the rest. Billing needs the books turned on.

## At the till

**Take payment** on a completed booking opens the till (`/pos?booking=…`) with the booked service in the cart.

- **The screen** names the customer and service, shows the deposit paid earlier, and shows the amount to pay.
- **More items:** other items can be added. The booked service must stay in the cart.
- **With a deposit:** the booking is paid in cash or by transfer.
  - Split and credit aren't offered; bill by invoice for credit.
  - If the deposit covers the whole bill, choose Cash.
- **Cash received** is checked against the amount due after the deposit.
- **Posting:**
  - The sale credits revenue for the full price, as any till sale does.
  - The deposit then leaves Customer deposits and advances. Cash: debit the deposit, credit cash. Transfer: debit the deposit, credit Transfers awaiting confirmation. The till, or the transfer waiting on Daily reconciliation, ends up holding only what the customer paid now.
- **Shift:** the cashier's shift counts the full sale, less the deposit applied, so expected cash matches the drawer.
- **The receipt** shows the total, "Deposit paid earlier" and "Paid now". The WhatsApp text includes the same lines.
- **Credit sale without a deposit:** bills the booking by its invoice.

## By invoice

**Bill by invoice** issues an invoice for the service at its catalogue price to the booking's customer. Walk-in bookings ask you to choose a customer first.

- **The invoice** is issued straight away, not left as a draft, so a deposit can be applied to it at once.
- **The deposit** is applied like a payment: debit Customer deposits and advances, credit the customer's receivable, allocated to the invoice (PR-11). The invoice then shows only the rest as owed.
- **Invoice number:** `BK-` followed by 8 characters of the request key.

## Rules

- **Only completed bookings, billed once.** The booking records how it was billed (`bill_kind`) and the sale or invoice (`bill_id`). Only the accounting API sets them; the database refuses changes through the Data API (`BOOKING_BILLED_ONCE`).
- **A deposit transfer still awaiting confirmation** blocks billing until it's confirmed.
- **Deposits** applied this way are marked `applied` with the posting kept.
- **Bookings screen:** shows "Paid at the till" or "Invoiced" once billed.

## Database

Migration `20261108110000_booking_billing.sql`:
- `appointments.bill_kind`, `bill_id`, `billed_at`. These are set together, and only on a completed booking.
- `transactions.booking_id` and `deposit_applied`.
- Shift cash entries accept `deposit_applied`.
- The booking guard now also refuses setting or clearing billing through the Data API.

New internal posting kind `deposit_application`. It is accepted only as debit the deposit and credit the till or Transfers awaiting confirmation, or as a credit to the customer's receivable allocated to an invoice.

## API

- `GET /bookings/{id}/bill`: the service, price, any open deposit and whether it's billed.
- `POST /bookings/{id}/invoice` (`invoices.post`), with `request_key` and `customer_id` for walk-ins.
- `POST /sales` accepts `booking_id`. Its result and the receipt include `deposit_applied` and `paid_now`.

## Tests

- `test_booking_billing_postgres.py` (3 cases, on a business started from the real chart):
  - **Till, cash:**
    - refused before completion; refused for split; refused when cash received is below what's due;
    - a cash payment applies the deposit, and a retry bills once;
    - the till and Customer deposits balances, the shift's expected cash, the receipt, and the deposit marked applied;
    - billing twice refused, through the API and through the Data API.
  - **Till, transfer:** waits for only the rest and is confirmed into the bank. A booking without a deposit is simply sold.
  - **By invoice:** the deposit comes off what's owed. A walk-in needs a customer chosen.
- Jest `booking-billing-ui`:
  - "Take payment" and "Bill by invoice" on a completed booking;
  - the till opened from a booking, with the deposit and amount to pay, the methods and cash check, and the booking sent with the sale;
  - the receipt text.
- The till test suites mock the booking action the till now imports.
- The OpenAPI contract is regenerated.

## Next

Part 4: jobs, with service and material lines, materials leaving stock at completion, and job profit on Chairman.
