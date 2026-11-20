# Purchasing, part 2: goods received and supplier returns (Doc 10, Doc 09 PR-18)

Deliveries can now be received, against a purchase order or on their own. Stock goes up at the actual cost and the product's average cost moves with it. The business then owes the supplier until their bill is entered, which is part 3. Receiving needs the books turned on, and purchasing is on the Oga and Chairman plans.

## Receiving (`/purchases/{order}` › Receive goods, or `/purchases/receipts` › Receive without an order)

- **Against an order:** each product still to come is listed with its outstanding quantity and the order's expected cost. Change either to match what actually arrived. Over-receiving and products not on the order are refused.
  - The order moves to Partly received, then Received.
- **Without an order:** choose the supplier and add products. A delivery note or reference can be added either way.
- **Weighted-average cost:** new average = (on hand × current average + received × received cost) ÷ (on hand + received), to four decimals.
  - Products on the adopted IFRS valuation update their valuation records instead.
  - Later sales are costed at the new average.
- **Posting (PR-18 with goods received not invoiced):**
  - Dr Inventory, Cr **Goods received not invoiced** (2010).
  - The account is added to the chart the first time goods are received. That first delivery must be received by the owner or an admin; the screen says so if someone else tries.
- **Numbering and replay:** receipts are numbered GR-0001 and never changed. Each is replay-safe under its request key, so a retried delivery is received once.

## Supplier returns (`/purchases/receipts/{id}` › Return to supplier)

- **What can go back:** goods from a receipt, up to what is left on it (received less returned and billed), with a reason.
- **At the received cost:** Dr Goods received not invoiced, Cr Inventory. Stock goes down and the average cost moves back.
- **Already billed:** goods that have been billed are returned with a supplier credit instead. That comes with bills.
- **The order** keeps its received quantities.

## Costs change only through receipts

When the books are on, the database refuses cost changes on a product with stock. Until now the only exception was an adopted valuation.
- The accounting runtime may now also set the cost to exactly the average that a receipt or return recorded in the same transaction (`accounting.cost_update`).
- Any other cost change is still refused (tested).

## Who can do what

| Action | Permission |
|---|---|
| See receipts | `inventory.view` |
| Receive goods, return to the supplier | `inventory.post` (Owner, Admin, Inventory manager) |
| First delivery (adds the 2010 account) | Owner or Admin |

## Database

Migration `20261109100000_goods_receipts.sql`:
- **Account kind:** `grni` (current liability, codes 2010 to 2090).
- **Receipts:** `accounting.goods_receipt` and `goods_receipt_line`. Only a line's returned and billed quantities may change, and only upwards (trigger).
- **Returns:** `accounting.supplier_return` and `supplier_return_line`.
- **Cost changes:** `accounting.cost_update`.
- **Product guard:** `management_private.catalog_guard` now allows the receipt's average.
  - The replacement runs only where that schema exists, which is every hosted project.
  - The test fixtures re-apply it after installing the original.

## API

- `GET /goods-receipts?order_id=`
- `POST /goods-receipts` (`inventory.post`)
- `GET /goods-receipts/{id}`
- `POST /goods-receipts/{id}/returns` (`inventory.post`)

## Tests

- `test_goods_receipts_postgres.py` (3 cases, on a business started from the real chart):
  - **Against an order:** a partial receipt at a new cost and its retry; the 2010 account; inventory and GRNI balances; stock; the average (1,287.0217); order states; over-receipt, received, draft and off-order receipts refused; a later sale costed at the new average. The books balance.
  - **Without an order:** the supplier is required; the first delivery needs an owner or admin. Then an inventory manager receives. A return at the received cost moves GRNI, stock and the average; over-returns and unknown products are refused.
  - **Guard and plan:** a direct cost change by the runtime is refused; receiving needs a plan with purchasing.
- Jest `goods-receipts-ui`:
  - receiving against an order, retried under the same request key;
  - a delivery without an order;
  - returning goods from a receipt;
  - a sent order offering Receive goods and listing its receipts.
- The OpenAPI contract is regenerated.

## Next

Part 3: bills for received goods.
- A bill matches the supplier's receipts: Dr Goods received not invoiced, Cr Payables.
- A difference between the bill and the received cost adjusts stock cost, following IAS 2. The share for units still on hand goes into the average; the share for units already sold goes to cost of sales.
