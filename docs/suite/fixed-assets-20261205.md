# Fixed assets (R4, IAS 16)

An asset register, depreciation posted each month, and disposals, all inside CACU.

The owner chose, on 26 November 2026:

- **How an asset is bought:** paid now, on credit from a supplier, or owned before the books started in CACU;
- **Methods:** straight-line and reducing balance;
- **Depreciation:** posted by an Owner or Admin as a deliberate step, and month close waits for it.

## The screen: Accounting › Fixed Assets (`/accounting/fixed-assets`)

- **Totals:** cost, depreciation to date, and worth in the books.
- **The register:** each asset with its kind, serial or tag number, method, purchase date and how it was bought, cost, depreciation and current worth.
- **A banner** for the oldest month still waiting for depreciation, with what it will charge and a **Post [month]** button.
- **Add an asset**, and **Sell or scrap** on each asset. The disposal form shows the gain or loss before it is recorded.
- **Sold or scrapped:** assets that have left the books, with their proceeds and result.
- **Depreciation posted:** each month, with its total.

Anyone who can see the ledger sees the register. Only an Owner or Admin adds assets, posts depreciation or records disposals.

## Accounts

Each kind of asset has its own cost account and accumulated depreciation account. Each is added to the chart the first time it is needed.

| Kind | Cost | Accumulated depreciation |
| --- | --- | --- |
| Land and buildings | 1500 | 1600 |
| Motor vehicles | 1510 | 1610 |
| Plant and machinery | 1520 | 1620 |
| Furniture and fittings | 1530 | 1630 |
| Computers and phones | 1540 | 1640 |
| Other equipment | 1550 | 1650 |

Two more accounts are shared by all kinds:

- **Depreciation (6700):** an operating expense.
- **Gains and losses on disposal of assets (4950):** other income.

Accumulated depreciation sits in the operating section of the cash flow statement. A month's depreciation moves no cash, so it nets to nothing there.

## Buying

| How | Entry | Notes |
| --- | --- | --- |
| Paid now | Dr asset cost, Cr the till or a bank | Dated the purchase date |
| On credit | A supplier bill: Dr asset cost, Cr payables | Listed under Bills and paid the usual way |
| Owned before CACU | Dr asset cost, Cr accumulated depreciation (depreciation to date), Cr retained earnings (the rest) | Dated the day it is brought in |

An asset owned before CACU:

- must have been bought before the books started;
- is brought in on or after the start date;
- has its depreciation to date counted up to the end of the month before it is brought in;
- is treated as a position brought in, so the cash flow statement leaves it out, as it does the opening position.

Dates must not be in the future, before the books started, or in a closed month.

## Depreciation

Each asset is charged monthly:

- **from** the month it is bought or brought in;
- **never in** the month it is disposed of;
- **never below** its residual value ("worth at the end").

| Method | Monthly charge |
| --- | --- |
| Straight-line | (cost less depreciation already brought in, less residual) ÷ the months of life left. The last month takes whatever remains, so the total is exact to the kobo. |
| Reducing balance | Carrying amount × yearly rate ÷ 12, rounded to the kobo |

**Posting a month** (`POST /fixed-assets/depreciation/{YYYY-MM}`) makes one journal for every asset:

- debit Depreciation;
- credit each kind's accumulated depreciation;
- dated the last day of the month.

The rules for posting:

- **In order:** months are posted in order, and only once they have ended.
- **Once each:** posting a month again changes nothing.
- **Nothing to charge:** a month with assets that are all fully depreciated is still recorded, with no journal.
- **Preview:** `GET /fixed-assets/depreciation/{YYYY-MM}` shows the charge asset by asset.

**Month close** has a new blocking step, "Depreciation posted for the month, for every fixed asset". It fails while the month has assets to depreciate and nothing posted.

## Disposals

`POST /fixed-assets/{id}/dispose` with the date, the proceeds (0 if scrapped), and the till or bank the money went into.

The journal:

- credits the asset's cost;
- debits its accumulated depreciation and the proceeds;
- posts the difference to gains and losses on disposal.

The rules:

- **Up to date first:** every earlier month's depreciation must be posted, so the asset leaves at its carrying amount.
- **Not after its month's charge:** if this month's depreciation already charged the asset, the disposal goes in a later month.

## Fixed once made

The register, the depreciation runs and charges, and disposals are never changed or deleted:

- database triggers refuse it;
- the runtime has no delete rights;
- on an asset, only its disposal is recorded, once.

A mistake is reversed with a journal. The new journal kinds (`asset_purchase`, `asset_opening`, `depreciation`, `asset_disposal`) are posted only by this workflow, and their shape is checked at posting.

## To review before release

- **Cash flow on disposal:** the cash flow statement shows a disposal's movement in cost under investing, and its depreciation and gain under operating. The proceeds net out correctly, but IAS 7 would show the proceeds alone under investing. An accountant should review this, or add a cash-flow rule for disposals.
- **VAT:** input VAT on assets bought on credit or paid is not claimed here. It goes on a separate bill or expense line for now.
- **Tax capital allowances:** these differ from book depreciation and are not covered. They are a later piece for the tax computation.
- **Impairment and revaluation (IAS 36, IAS 16 revaluation model):** not covered.
