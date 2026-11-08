# Offline selling and expenses (Doc 10 E17, Doc 13)

Owner decisions of 7 November 2026: keep the price a sale was made at when it was the catalogue price then; post a sale whose stock ran short and list the shortfall; offline payments are cash and transfer; offline sales first, offline expenses next. Offline selling needs the books on (the till's normal sales do) and is on every plan (`module.offline`).

## On the till

- **Losing the connection:** the till says "You are offline" and keeps selling from the catalogue already on screen. If the till is opened again without a connection, it uses the catalogue this phone saved last time (prices dated on the banner) and its last copy of the page (`public/sw.js`).
- **What can be sold:** cash and transfer. Split, credit, bookings and jobs need the internet; the checkout says so.
- **Each sale** waits on the phone (IndexedDB, per business and per person) under its request key, at the prices and discounts shown, with the time, the shift's outlet and how it was paid. The till says "Sale saved on this phone. It will be sent when you are back online." There is no receipt until CACU accepts it.
- **Sending:** on load, when the connection returns, and every minute, the phone sends its owner's waiting sales one by one. A sale is only sent by the person who made it. When an answer is lost the sale stays waiting and sending stops until the next try; the same key means it can never post twice.

## When a sale arrives (`POST /sales/offline`, `sales.post`)

- **Posted** when every price was the catalogue price at the moment of the sale (from the catalogue's change history), each discount is within the seller's limit, and the date is open. It is dated the day it was made (Lagos), from its outlet; stock that ran short meanwhile is posted and listed as a shortfall for the owner. A transfer waits for confirmation as usual (BR-010). No open shift is required.
- **Already posted** under that key (an online attempt whose answer was lost): reported as posted.
- **Review**, with the reason, otherwise:

| Reason | Example |
|---|---|
| `price` | "Beans: sold at ₦1,500.00, catalogue price then ₦1,800.00" (an edited price) |
| `discount` | above the seller's discount limit |
| `valuation_stock` | a product on the adopted IFRS valuation without the stock |
| `closed_period` | dated before the books started, in the future, or in a closed period |
| `too_old` | more than 7 days old, or the device clock was more than 10 minutes ahead |
| `item_unavailable` | a product no longer active |

## Expenses recorded offline (part 2)

- **Accounting › Expenses** works without a connection too: the expense waits on the phone under its request key (with the accounts this phone saved last time, if the page was opened offline) and is sent like a sale.
- **On arrival** (`POST /expenses/offline`, `expenses.post`): posted as recorded (Dr the expense account, Cr cash or the bank), or held for review when it is more than 7 days late, dated in a closed period or before the books started, or recorded against an expense account no longer in the chart (`account_unavailable`). An expense already posted under its key is reported as posted.
- **Review:** Owners and Admins post or discard offline expenses; posting refuses an account that is no longer in the chart.

## Settings › Offline (`/settings/offline`)

- The connection, the sales waiting on this phone (with Send now and Export to a file), and anything CACU did not accept. A sale leaves the phone only once it is posted, or when someone chooses Discard (with a warning that it has not been recorded).
- **Waiting for review:** people who approve sales (`sales.approve`) post each one as sold or discard it with a reason; others see their own. Posting as sold uses the recorded prices.

## Database

Migration `20261112090000_offline_sales.sql`: `accounting.offline_entry` (every offline sale and expense the server has seen, its kind, status, reason and decision; RLS for `cacu_runtime`) and `accounting.price_at` (a product's price at a moment, from `management_private.audit`).

## API

- `POST /sales/offline` (`sales.post`), `POST /expenses/offline` (`expenses.post`), `GET /offline-review` and `POST /offline-review/{id}` (each entry checked: sales by people who approve sales, expenses by Owners and Admins; others see their own).

## Tests

- `test_offline_sales_postgres.py` (3): offline expenses post once; late, closed-period and archived-account expenses wait; only Owners and Admins decide; an archived account cannot be posted.
- Sales: a sale at the old price posts once after a price rise, dated when made; short stock posts with the shortfall listed; a sale already posted online under the key is not posted again; a payload that does not add up is refused; edited prices, old sales and large discounts wait for review; the seller sees their own; only approvers decide; posting uses the recorded price; discarding needs a reason; a decided sale cannot be decided again. The books balance.
- Jest `offline-sales-ui` (4): an expense kept on the phone and sent on reconnect; the offline till keeps a cash sale on the phone (and refuses credit); sending on reconnect (posted leave the phone, review stays marked) and an approver discarding; a lost answer stops sending, and another person's sale is not sent.

