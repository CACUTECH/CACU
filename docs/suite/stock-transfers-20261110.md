# Purchasing, part 4b: transfers between outlets (Doc 10)

Owner decision of 7 November 2026: send, then receive. Goods leave one outlet, are in transit, and the other outlet confirms what arrived. Transfers need the books on, two open outlets, and a plan with purchasing (Oga or Chairman).

## Sending (`/purchases/transfers` › Send stock)

- Choose the sending and receiving outlets and the products, up to what the sending outlet holds. A person tied to one outlet sends only from it. Goods can be sent out of a closed outlet, but not into one.
- The transfer is numbered TR-0001. The goods leave the sending outlet at once and show as **in transit** on Stock by outlet.
- **Nothing is posted.** The goods are still the business's, at the same weighted-average cost, so neither the product's total nor the books change.
- Replay-safe under its request key: a retried send sends once.

## Receiving (`/purchases/transfers/{id}` › Receive)

- The receiving outlet counts what arrived, prefilled with what was sent. Only someone at that outlet (or someone who works at all outlets) can receive it.
- What arrived goes into the receiving outlet's stock.
- **A shortfall is a loss with a reason.** It leaves the product's total at its cost (or the adopted valuation's share, with its allowance) and posts Dr Stock adjustments and write-offs (5100), Cr Inventory. The stock event records no outlet, since the goods were lost between outlets.
- A transfer is received once; the record cannot change after that (trigger).

## Who can do what

| Action | Permission |
|---|---|
| See transfers, stock by outlet | `inventory.view` |
| Send, receive | `inventory.post` (Owner, Admin, Inventory manager) |

## Database

Migration `20261110100000_stock_transfers.sql`:
- `accounting.stock_transfer` and `stock_transfer_line`, with RLS for `cacu_runtime`. Only the receipt fields may be filled in, once (trigger `stock_transfer_moves`).
- The runtime may now insert and update `outlet_stock` quantities (sending and receiving move goods between outlets).
- Outlet foreign keys run only where the outlets table exists; the test fixtures re-apply them between the markers `-- transfer outlets begin/end`.

## API

- `GET /stock-transfers?status=in_transit|received`, `GET /stock-transfers/{id}` (`inventory.view`)
- `POST /stock-transfers` (send), `POST /stock-transfers/{id}/receive` (`inventory.post`)

## Tests

- `test_stock_transfers_postgres.py` (2 cases): sending more than the outlet holds, or to the same outlet, is refused; a sent transfer and its retry; the goods are in transit with the total and the books unchanged; a short receipt needs a reason and cannot exceed what was sent; a member at the sending outlet cannot receive; the loss of one bag of rice (₦50,000) leaves stock and posts to 5100; a second receipt is refused; a member tied to an outlet sends only from it and receives into it; a full receipt posts nothing; unknown outlets and the BASE plan are refused. The split adds up and the books balance.
- Jest `stock-transfers-ui`: sending (outlet and quantity checks), a member tied to an outlet, receiving with a shortfall and its reason.

Purchasing (E09) parts 1 to 4 are now built.
