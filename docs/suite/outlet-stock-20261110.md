# Purchasing, part 4a: stock per outlet (Doc 10)

Owner decisions of 7 November 2026: a business with several outlets holds its stock per outlet; a till sells from the outlet chosen when its shift opens; transfers are sent and then received (part 4b). Stock per outlet needs the books on, like the rest of purchasing.

## How it works

- **The product keeps its total and its cost.** `catalog_items.stock_quantity` is still the business's total, and each product keeps one weighted-average cost across outlets (IAS 2 allows one cost formula for the same goods). Valuation and postings do not change.
- **The split:** once a business has outlets, `accounting.outlet_stock` holds what each outlet has. The split, plus goods in transit (part 4b), always adds up to the total.
- **First outlet:** outlets are added in Users › Branches and locations. The first outlet a business adds takes all its current stock. Until then nothing changes.
- **Where stock moves:** the runtime names the outlet for each action (the transaction setting `cacu.outlet`); a database trigger applies every change in the product's total to that outlet.

| Action | Outlet |
|---|---|
| Till sale | The seller's open shift's outlet; else the outlet they are tied to; else the main outlet |
| Job materials | As for a till sale, for the person completing the job |
| Refund back to stock | The outlet the sale took the goods from |
| Goods received | Chosen on the receipt (asked only when there are several open outlets and the person is not tied to one) |
| Supplier return | The receipt's outlet |
| Anything else (stock counts and adjustments, legacy paths, invoices) | The main outlet: the earliest open one |

- **An outlet cannot sell what it does not hold.** A till sale, a job or a supplier return asking for more than the outlet holds is refused, naming the outlet ("Only 10 x Beans at Yaba shop. Transfer more there, or sell from the outlet that has it."). Where the owner allows overselling (BR-022), only what the outlet holds is costed and the rest is listed as a shortfall, as before.
- **Changes that name no outlet** and take out more than the main outlet holds take the rest from the other outlets, so no outlet shows less than nothing while the total does not.
- **Shifts:** opening a shift asks for the outlet when there are several and the person is not tied to one. A person tied to an outlet cannot open a shift elsewhere. The shift shows its outlet.
- **Closed outlets** keep whatever stock they hold (for example after a plan downgrade) and show it as "(closed)" until it is transferred out.

## Screens

- **Purchases › Stock by outlet** (`/purchases/stock`): each tracked product by outlet, with the total. Without outlets it explains how to add them.
- **Receive goods:** a "Receiving outlet" choice when needed. Receipts show the outlet.
- **Till › Open shift:** an "Outlet" choice when needed. The shift bar shows the outlet.

## Database

Migration `20261110090000_outlet_stock.sql`:
- `accounting.outlet_stock` (RLS for `cacu_runtime`, SELECT only); `location_id` on `till_shift`, `goods_receipt` and `stock_event`.
- Definer functions `accounting.main_outlet`, `accounting.current_outlet` (runtime may execute) and the triggers `outlet_stock_follow` (on products), `outlet_first_stock` (on outlets) and `stock_event_outlet`. They read only rows of the business in hand.
- The runtime may read its own business's outlets (`runtime_read` policy on `business_locations`).
- The outlet parts run only where the outlets table exists (every hosted project); the test fixtures re-apply them, between the markers `-- outlet stock begin/end`.

## API

- `GET /outlets` (`inventory.view`): open outlets and the person's own outlet.
- `GET /outlet-stock` (`inventory.view`): stock by outlet.
- `POST /shifts` and `POST /goods-receipts` take an optional `location_id`.

## Tests

- `test_outlet_stock_postgres.py` (2 cases): the first outlet takes all stock; receiving needs an outlet when there are several; a till at Yaba cannot sell more than Yaba holds; the owner's sale without a shift comes from the main outlet; the stock event records the outlet; a refund goes back to Yaba; a member tied to Ikeja cannot open a shift at Yaba and gets Ikeja by default; a stock count with no outlet takes the excess from the other outlet; the stock-by-outlet view; supplier returns limited to what the receiving outlet holds; businesses without outlets unchanged. The split adds up and the books balance.
- Jest: receiving into a chosen outlet; no question for a member tied to one; stock by outlet; opening a shift at a chosen outlet.

## Next

Part 4b: transfers between outlets, sent and then received, with any shortfall on arrival recorded as a loss with a reason.
