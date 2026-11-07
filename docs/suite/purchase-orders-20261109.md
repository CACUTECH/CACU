# Purchasing, part 1: purchase orders (Doc 10, Doc 07 M-12)

A business can now order stock from its suppliers. A purchase order changes nothing in the books. Stock and the amount owed are recorded when the goods arrive, in part 2.

Purchasing is on the Oga and Chairman plans (`module.purchasing`). Businesses not yet billed keep it, as with every other feature until billing launches. It shows for Product and Hybrid businesses.

Decided 7 November 2026:
- Parts 1 to 3 now: orders, goods received, bills for received goods.
- Stock per outlet and transfers between outlets later, once there are multi-outlet pilot shops.
- When a supplier's bill differs from the received cost, the difference adjusts stock cost (IAS 2). This applies from part 3.

## Orders (`/purchases` and `/purchases/{id}`)

- **New order:** a supplier (added in Suppliers), an optional date to deliver by, and notes for the supplier.
- **Numbers** come from the database: PO-0001, PO-0002 and so on.
- **Items:** active products whose stock is tracked, each once, with a quantity and the expected cost per unit. The cost is filled in from the product's current cost. The real cost is confirmed when the goods arrive. Services and untracked products can't be ordered.
- **States:**

  | From | To | Who |
  |---|---|---|
  | Draft | Sent | `inventory.edit`; needs at least one item |
  | Draft or Sent | Cancelled | `inventory.edit`; needs a reason |
  | Sent or Partly received | Partly received or Received | Only the accounting API, when goods are received (part 2) |

  - Items change only while the order is a draft. To change a sent order, cancel it and make a new one.
  - Received and cancelled orders can't change.
  - Orders are cancelled, never deleted.
- **Sending:** once sent, the order can go to the supplier by WhatsApp (from the supplier's Nigerian phone number), by email, or printed. The text lists each item, quantity and cost, the total, the delivery date and the notes.

## Who can do what

| Action | Permission | Templates |
|---|---|---|
| See orders | `inventory.view` | Everyone with inventory, including Cashier and Auditor |
| Draft an order and its items | `inventory.create` | Owner, Admin, Inventory manager, Bookkeeper |
| Send or cancel | `inventory.edit` | Owner, Admin, Inventory manager |

Writes also need a plan with purchasing. While a subscription is suspended, new orders and changes are refused, as for other trading records.

## Database

Migration `20261109090000_purchase_orders.sql`:
- `public.purchase_orders` and `public.purchase_order_lines`, with row security by the permissions above.
- `public.purchasing_allowed(business)`: whether the plan includes purchasing.
  - SECURITY DEFINER, for the business's own active members only.
  - Used by the write policies and by the screens.
- Rule triggers:
  - `purchase_orders_rules`: numbering, states, the reason to cancel, the supplier belongs to the business, and receiving only through the accounting API.
  - `purchase_order_lines_rules`: lines only on drafts; stocked products only; the received quantity is set only by the accounting API.
- The accounting runtime can read orders and lines, and update the received quantity and status. Part 2 uses this.

## Tests

- `test_purchase_orders_postgres.py` (3 cases, as signed-in members through row security):
  - **States and posting:** numbering; an empty order can't be sent; a duplicate item is refused; lines are locked once sent; receiving is refused through the Data API; a cancellation needs a reason; closed orders are locked; orders are never deleted; nothing posts and the books balance.
  - **Items and permissions:** services, untracked and unknown items are refused, as is another business's supplier. A bookkeeper drafts but can't send. A cashier sees orders but can't draft them.
  - **Plan:** the General plan has no purchasing; Oga has it.
- Jest `purchase-orders-ui`:
  - totals, the WhatsApp number, the order text and the error wording;
  - drafting an order with a product at its cost, then marking it sent;
  - sharing a sent order by WhatsApp and email, and cancelling it;
  - the list on the General plan, and starting an order.

## Next

Part 2: goods received against an order or on their own.
- Stock goes up and the weighted-average cost is recalculated.
- The receipt posts Dr Inventory, Cr Goods received not invoiced (2010, added to the chart on first use).
- Supplier returns correct a receipt.
