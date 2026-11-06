# POS, part 2: checkout (Doc 10, E10)

Cash received and change, line discounts within a cap, split cash and transfer, credit to a named customer, the overselling setting, and receipts. Decided 7 November 2026: overselling is off by default; discounts use `sales.edit` plus a cap per template, rather than a separate `sales.discount` permission.

These features need the business's books turned on (native accounting). Before that, the till works as it did.

## Checkout

- **Prices** come from the catalogue, as before.
- **Line discounts:** a percentage per line, up to two decimals.
  - Needs `sales.edit`. The Cashier template gains `sales.edit` for this; it doesn't open anything else to cashiers, because changing sales through the Data API still needs the Owner or Admin role.
  - Capped by the member's template: 5% unless the owner sets otherwise. Owners aren't capped. Templates without `sales.edit` can't discount.
  - The owner sets each template's limit on Team › Access templates.
  - Revenue is recorded net of the discount (IFRS 15). The discount is kept on the line and the sale.
  - A discount above the limit is refused: "Your discount limit is 5%. Ask the business owner for a bigger discount."
- **Cash received and change:** optional for cash and split sales. The till shows the change; both are saved on the sale and shown on the receipt. Less than what's due is refused.
- **Payment methods:**

  | Method | Posting | Sale status |
  |---|---|---|
  | Cash | Debit cash, credit revenue (unchanged) | `completed` |
  | Transfer | Debit Transfers awaiting confirmation, credit revenue (part 1) | `pending_payment` |
  | Cash + transfer | Debit cash (cash part) and Transfers awaiting confirmation (transfer part), credit revenue | `pending_payment` until the transfer part is confirmed |
  | On credit | An issued invoice to the chosen customer, numbered `POS-…`; receivables, receipts and ageing work as for any invoice | invoice `sent` |

  - Card stays unavailable until the terminal decision (Doc 10 open question).
  - A split sale whose transfer never arrives is reversed in full on Daily reconciliation. The goods return to stock, and the screen shows the cash part to hand back.
  - Discounts aren't available on credit sales yet, because invoices don't carry discounts. That comes with invoice discounts.
- **Overselling (BR-022):** off unless the owner switches it on, from Daily reconciliation › Stock sold beyond records.
  - When on, the till lets a line go past recorded stock. Stock stops at zero, because production keeps the `stock_quantity >= 0` check. Only the units on hand are costed, so the inventory account still matches stock times cost.
  - The rest is listed as a shortfall to count, correct and mark reviewed before the period closes (RSK-027).
  - Products on adopted (IFRS) valuation can never be oversold.

## Receipts

`/pos/receipt/{sale}` shows the business name, receipt number (the ledger document number), date, items with any discount, total, payment method, cash received and change, and "Transfer awaiting confirmation" or "Reversed" where that applies.

- **Print** at 58 mm or 80 mm, using the browser's print.
- **Share on WhatsApp** opens WhatsApp with the receipt as text.
- **Not yet:** email (needs Resend) and a public link that works without signing in (needs signed, expiring links). Both are planned with notifications.

## Database

Migration `20261107100000_pos_checkout.sql`:
- `transactions`: `cash_received`, `change_given`, `transfer_amount`, `discount_total`; payment method `split` allowed.
- `transaction_items.discount`.
- `accounting.sales_policy`: overselling, one row per business, owner only.
- `accounting.stock_shortfall`: decided once, reviewed later.
- `authz.discount_caps`, with `authz.discount_cap()` and `public.save_discount_cap()` (Owner only), and `public.discount_caps()` for the team screen.

## API

- `GET /sales/options`: the member's discount limit and whether overselling is on.
- `POST /sales/policy`: the Owner's overselling setting.
- `GET /sales/{id}/receipt`
- `GET /stock/shortfalls` and `POST /stock/shortfalls/{sale}/{item}/review` (`inventory.approve`).
- `POST /sales` now takes `discount_percent` per line, `cash_received`, `transfer_amount`, `customer_id`, and methods `Split` and `Credit`.

## Tests

- `test_pos_checkout_postgres.py` (5 cases, on a business started from the real chart):
  - change and an owner discount on the receipt;
  - a cashier's 5% limit, raised by the owner;
  - split sales confirmed, and reversed in full, with the trial balance and cash flow reconciled;
  - a credit sale as an issued invoice;
  - overselling off, then on, with shortfalls reviewed.
- Jest:
  - the POS screen: discount limit, change, split and credit;
  - Daily reconciliation's overselling switch and shortfall review;
  - kobo rounding that matches the server, discount validation, and the WhatsApp text.
- The OpenAPI contract is regenerated.

## Next

- POS part 3: parked sales and refunds (PR-16, FR-044).
- POS part 4: cashier shifts with float, pay-ins and pay-outs, and over/short (PR-22).
