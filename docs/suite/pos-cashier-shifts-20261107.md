# POS, part 4: cashier shifts (Doc 10, PR-22)

A cashier opens a shift with the cash in the till, pays cash in or out with a reason, and closes by counting the cash. Any difference from the expected cash is recorded as cash over or short and shown to the owner.

Shifts are on the Oga and Chairman plans (Doc 10 "Innovator, Empire"). Businesses not yet billed keep them, as with every other feature until billing launches. Shifts need the books turned on (native accounting).

## On the till

A strip above the till shows the person's shift.

- **Open shift:** count the cash in the till (the float). One open shift per person.
- **What belongs to a shift:** while it is open, these are tagged to it:
  - every sale the person records, with the cash it brought in (the cash part of a cash + transfer sale);
  - cash refunds paid from their till;
  - their pay-ins and pay-outs.
- **Expected cash** = float + cash sales − cash refunds + pay-ins − pay-outs − cash handed back on reversed sales. The strip shows it after every sale.
- **Pay in or out:** an amount, a reason, and where the money went or came from.

  | Movement | Posting |
  |---|---|
  | Pay-out spent on something, for example diesel | Debit the chosen expense, credit cash (PR-17) |
  | Pay-out into the bank | Debit the bank, credit cash (PR-21) |
  | Pay-in from the bank | Debit cash, credit the bank (PR-21) |

  - Cash over and short can't be chosen as an expense; it is kept for shift closes.
  - A pay-out can't be larger than the expected cash.
  - Only the cashier on the shift can pay cash in or out of it.
- **Close shift:** the cashier sees the float, cash sales, refunds, pay-ins and pay-outs, and the expected cash, then enters the cash counted.
  - The difference shows as "₦300.00 short" or "₦100.00 over". A difference needs a short explanation.
  - **Posting (PR-22):** a shortage debits Cash over and short (6900) and credits cash; a surplus does the reverse. Nothing posts when the count matches. This is a new internal posting kind, `shift_variance`, which the generic postings route can't post.
  - The cashier closes their own shift. Someone with `sales.approve` (Owner, Admin, Sales manager) can close anyone's, for example one left open.
  - A shift is closed once (database trigger). Nothing is added to a closed shift.

### Who tags what

- A cash refund approved later is taken from the requester's open shift, because the cashier hands the cash back (Doc 12 UJ-06). If the requester has no open shift, it comes from the approver's open shift.
- When a cash + transfer sale is marked not received, the cash part handed back comes from the open shift of the person who marks it.
- Sales made without an open shift aren't on any shift.

## The owner's rule

On the Shifts page the owner can require a shift before selling. When it's on, the till won't check out for anyone without an open shift, and the server refuses the sale too. It is off by default.

## Who sees what

- **Shifts page (`/pos/shifts`):** the day's shifts, with float, sales, expected cash, counted cash and the difference with its explanation, plus every shift still open.
  - People with `sales.approve` or `banking.view` see everyone's; others see their own.
- **Daily reconciliation › Shifts:** the day's closed shifts and the total difference, each shift that didn't match, and shifts still open.
- **Open past midnight:** a shift still open after midnight business time is flagged on the home screen, the till, the Shifts page and Daily reconciliation.

## Permissions

| Action | Permission |
|---|---|
| Open a shift, pay in or out, close your own | `sales.post` (Cashier, Sales manager, Admin, Owner) |
| Close someone else's shift | `sales.approve` |
| See your shift and the shifts list | `sales.view` |
| Require shifts | Owner only (route needs `settings.edit`) |

The pay-out's expense list comes with the open shift, so cashiers don't need `expenses.view`.

## Database

Migration `20261107120000_pos_cashier_shifts.sql`:
- A plan entitlement `module.shifts`: General false, Oga and Chairman true.
- `accounting.shifts_allowed(business)`: the plan check for the accounting runtime.
  - SECURITY DEFINER, because the runtime can't read the `platform` schema.
  - Only for the business the session is authorized for. Executable by `cacu_runtime` only.
- `accounting.sales_policy.require_shift`.
- `accounting.till_shift`:
  - one open shift per person (unique index);
  - closed once, by trigger;
  - checks: closed shifts carry the count, and the difference equals counted less expected.
- `accounting.till_movement`: pay-ins and pay-outs, with their posting.
- `accounting.till_shift_entry`: the shift's cash ledger.
  - Append-only (no update or delete grants).
  - Signed by kind: sales and pay-ins are positive; refunds, pay-outs and handed-back cash are negative.
  - A trigger refuses entries and movements for a closed shift.
- All three tables have row security for `cacu_runtime`.

## API

- `GET /shifts/current`: whether shifts are on the plan, the owner's rule, the person's open shift with its movements, whether they can close others' shifts, and the expense accounts for pay-outs.
- `GET /shifts?day=&status=`
- `POST /shifts` (Doc 11), with `request_key` and `opening_float`.
- `POST /shifts/{id}/movements`, with `kind` (`pay_in` or `pay_out`), `amount`, `reason`, and `expense_account_id` or `bank_account_id`.
- `POST /shifts/{id}/close` (Doc 11), with `counted_cash` and `note`.
- `POST /shifts/policy` (Owner).
- Existing endpoints gained fields:
  - `GET /sales/options` now includes `require_shift`.
  - Daily reconciliation includes `shifts`: closed, open and `variance_total`; null when the plan has no shifts.

Every write is replay-safe under its request key.

## Tests

- `test_pos_shifts_postgres.py` (4 cases, on a business started from the real chart):
  - **Shortage:** a cashier's float, cash and split sales, a pay-out for fuel, a pay-in and a bank deposit, giving expected cash of ₦9,300. Then the checks: a retried open, a second open, an over-large pay-out, someone else's pay-out, Cash over and short as an expense, and a missing explanation. Then a ₦300 shortage posted to 6900, with the trial balance and cash flow reconciled.
  - **Refund, reversal and a manager's close:** a cashier's cash refund approved by an admin comes out of the cashier's shift; a reversed split sale's cash comes out of the admin's shift; a manager closes the cashier's shift ₦100 over.
  - **Overdue and the owner's rule:** a shift open past midnight is flagged and closed with no posting. Only the owner can require shifts, and once required, sales without a shift are refused.
  - **Plan gate:** General has no shifts; Oga does.
- Jest:
  - `pos-shifts-ui`:
    - the difference wording and the plan highlight;
    - opening a shift retried under the same request key;
    - a pay-out and a short close;
    - the till blocked without a required shift;
    - the General plan;
    - the owner's rule and a manager closing a forgotten shift.
  - `daily-reconciliation-ui`: the Shifts card.
- The OpenAPI contract is regenerated.

## Not yet built

- Counting by note and coin, and printing a shift report.
- A shift per till or outlet: shifts are per person for now.
- An approval threshold for large differences.
