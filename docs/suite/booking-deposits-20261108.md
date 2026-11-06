# Bookings, part 2: deposits and cancellations (Doc 10, PR-12)

Customers can now pay a deposit when they book. The deposit is held as money the business owes back until the service is delivered. If they cancel in time it is refunded. If they cancel late or don't come, the owner's rule decides. Decided 7 November 2026: by default the deposit is kept as income.

Deposits need the books turned on. Before that, bookings work as in part 1.

## Settings (`/appointments/settings`, Owner and Admin)

- **Deposit per service:** none, a fixed amount, or a percentage of the price. A fixed amount larger than the price asks for the price.
- **Free cancellation:** up to N hours before the booking (24 by default, at most 720). Cancelling earlier than that refunds the deposit.
- **Late cancellation or no-show:** keep the deposit as income (default) or refund it.
- **Chart:** the first time a deposit is set, CACU adds **Customer deposits and advances** to the chart of accounts, as an added current liability numbered from 2100. It's added once; it isn't part of the default chart template.

## Taking a deposit

On a confirmed or checked-in booking, **Take deposit** suggests the service's deposit. Any amount up to the service price can be taken. One deposit is open per booking.

| Paid by | Posting | Deposit status |
|---|---|---|
| Cash | Debit cash, credit Customer deposits and advances (PR-12). Added to the cashier's open shift. | Held |
| Bank transfer | Debit Transfers awaiting confirmation, credit Customer deposits and advances | Transfer awaiting confirmation |

A transfer deposit is listed with the other transfers on **Daily reconciliation**, as "Booking deposit":
- **Confirm:** moves the money to the chosen bank (PR-04). The deposit is then held.
- **Not received:** takes the deposit back out of Customer deposits (debit Customer deposits, credit Transfers awaiting confirmation). The booking stays, without a deposit.

## Cancelling and no-shows

A booking holding a deposit is cancelled or marked no-show through the accounting API. That way the booking and its deposit settle in one transaction. The database refuses the change through the Data API (`DEPOSIT_HELD`).

| When | Deposit |
|---|---|
| Cancelled before the free window ends | Refunded: debit Customer deposits, credit cash (from the till, out of the person's shift) or the bank it came into |
| Cancelled later, or no-show | The owner's rule: keep (debit Customer deposits, credit service income, or revenue when there is no separate service income) or refund |
| Transfer still awaiting confirmation | Can't cancel yet: confirm it or mark it not received first |

- Choosing the other outcome to the rule needs `sales.approve` (Owner, Admin, Sales manager).
- A cancellation needs a reason. A no-show is only possible once the start time has passed.

## Shifts

Cash deposits add to the cashier's expected cash; cash deposit refunds take it away. The close dialog shows "Booking deposits (less refunds)".

## Who can do what

| Action | Permission |
|---|---|
| See deposits and the rules | `services.view` |
| Take a deposit | `sales.post` (Cashier, Sales manager, Admin, Owner) |
| Cancel or mark no-show | `services.edit` |
| Go against the deposit rule on a late cancellation | `sales.approve` |
| Change the rules | `settings.edit`, and Owner or Admin to add the account |

## Database

Migration `20261108100000_booking_deposits.sql`:
- A new account kind `customer_deposits` (current liability, codes 2100 to 2199).
- `accounting.booking_policy`: the free window and the late rule.
- `accounting.service_deposit_rule`.
- `accounting.booking_deposit`:
  - one open deposit per booking;
  - moves forward once, by trigger: from awaiting transfer to held or not received; from held to refunded, kept or applied.
- `pending_transfer.source_type` accepts `deposit`.
- Shift cash entries accept `deposit` and `deposit_refund`.
- The accounting runtime can read and update bookings under its tenant policy.
- `appointments_deposit_guard`: refuses Data API cancellations and no-shows of a booking that holds a deposit.

New internal posting kinds: `booking_deposit` and `deposit_settlement`. They are validated so that a deposit only moves between the till, Transfers awaiting confirmation or a bank, and Customer deposits, and is only refunded or kept as income.

## API

- `GET /bookings/settings` and `POST /bookings/settings`.
- `GET /bookings/deposits?start=&end=`.
- `POST /bookings/{id}/deposit`, `POST /bookings/{id}/cancel` and `POST /bookings/{id}/no-show`. Every write is replay-safe under its request key.

## Tests

- `test_booking_deposits_postgres.py` (3 cases, on a business started from the real chart):
  - **Cash deposit refunded in time:** the owner sets the rule, which adds account 2100 once; a cashier's cash deposit goes into their shift; a retry takes it once; an over-price deposit and a second deposit are refused; a Data API cancel is refused; a cancel in time refunds it. The books balance.
  - **Late cancellations and transfers:** a late cancellation keeps the deposit as service income, and service staff can't go against the rule. A transfer deposit waits, is listed on Daily reconciliation, is confirmed into the bank, and an admin refunds it on a late cancellation.
  - **No-show and unpaid transfer:** a no-show keeps the deposit, but not before the start time. A transfer that never arrived takes the deposit back.
- Jest `bookings-ui` (4 more cases):
  - deposit amounts and the free window;
  - taking a transfer deposit, retried under the same request key;
  - a late cancellation that keeps the deposit;
  - the settings page;
  - the message shown before the books are on.

## Next

Part 3: completing a booking creates a draft invoice or a till sale for the service, with a held deposit applied (PR-13). The deposit status `applied` is reserved for it.
