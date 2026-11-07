# Purchasing, part 3: supplier bills for received goods (Doc 10, Doc 09 PR-18)

A supplier's bill can now be entered against goods already received. It clears what was owed as "goods received not invoiced", becomes a normal bill in Bills, and is paid like any other bill. Where the bill differs from the received cost, the difference adjusts stock cost under IAS 2 (owner decision, 7 November 2026). Bills need the books on and a plan with purchasing (Oga or Chairman).

## Entering a bill (`/purchases/receipts/{id}` › Enter supplier's bill)

- **Prefilled:** every product still billable on the receipt (received less returned and already billed), at its received value.
- **Fields:** the supplier's bill number, bill date (today or earlier, not before the goods arrived), optional due date and notes.
- **A different amount** (a new price, a delivery charge): the dialog shows the difference and whether it adds to or comes off the cost.
- **Replay:** the bill is replay-safe under its request key; a retry records it once.

## Posting

- **The bill:** Dr Goods received not invoiced (2010), Cr Payables for the billed total. Filed as a supplier bill (`document_map` source type `bill`), so it is listed, part-paid and paid through Bills.
- **A difference** (billed − received value), per product, as an adjustment that clears 2010 at the received cost:
  - the share for units still on hand, `difference × min(quantity, on hand) ÷ quantity`, goes to Inventory and into the weighted-average cost (or the adopted IFRS valuation);
  - the share for units already sold goes to Cost of sales.
- **Example (tested):** 10 received at ₦1,300, 8 sold (5 on hand), billed ₦12,000: −₦500 to stock, −₦500 to cost of sales; 2010 cleared by ₦13,000.

## Rules (refused with a message)

- The same bill number for the same supplier twice (case and spaces ignored).
- A receipt from another supplier; a bill dated before the goods arrived or in the future; a due date before the bill date.
- More than is still billable on a line.
- Returning goods that have been billed (that needs a supplier credit, later).

## Who can do what

| Action | Permission |
|---|---|
| Enter a bill | `expenses.post` (Owner, Admin, Editor) |
| Pay it | as for any bill |

## Database

Migration `20261109110000_goods_bills.sql`: `accounting.supplier_bill_receipt` records which receipt lines each bill covers, the received value, the billed amount and the split (`to_stock + to_cost_of_sales = billed − received`, checked). RLS for `cacu_runtime`; SELECT and INSERT only.

## API

- `POST /goods-receipts/bills` (`expenses.post`): `{request_key, supplier_id, bill_number, entry_date, due_date, notes, lines: [{receipt_id, item_id, quantity, amount}]}` → `{id, bill_number, total, received_value, difference_to_stock, difference_to_cost_of_sales, posting}`.

## Tests

- `test_goods_bills_postgres.py` (3 cases): a bill above cost and its retry, balances, the new average, listing and part payment, duplicate number, over-billing and return-after-billing refused; a cheaper bill after a partial sale split between stock and cost of sales; wrong supplier, early date, over-quantity, viewer and BASE plan refused. The books balance.
- Jest `goods-receipts-ui`: the bill dialog prefills, validates, shows the difference and sends the bill.
- The OpenAPI contract is regenerated.

## Next

Part 4 (stock per outlet and transfers) is for the owner to decide.
