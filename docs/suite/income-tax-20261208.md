# Company income tax estimate (R4, Nigeria Tax Act 2025)

A yearly estimate of companies income tax (CIT) and the development levy, worked out from the books with every step shown, for the owner and their tax adviser. The estimate posts nothing; the Owner can post a finished year's tax to the books (below). CACU files nothing.

The owner decided, on 26 November 2026:

- **Estimate only.** It sits behind `accounting.income_tax_switch`, which starts off until a tax professional reviews the estimate. It is on for CACU's preview business.
- **Small company turnover of ₦50m,** from the Act's text. The June 2026 transition guidelines and some advisers say ₦100m. The limit is kept in one reviewed row (`accounting.income_tax_rule`), so it changes in one place.

## The computation

| Step | From |
| --- | --- |
| Profit before tax | Every income and expense account for the tax year |
| + depreciation in the books | Depreciation (6700); replaced by capital allowances |
| − book gain on disposals / + book loss | Gains and losses on disposal (4950); replaced by balancing charges and allowances |
| + expenses the law does not allow, − income that is not taxable | Adjustments the owner enters |
| **= Adjusted profit** | |
| − losses brought forward | Entered by the owner; losses carry forward indefinitely |
| **= Assessable profit** | **Development levy 4%** |
| + balancing charges − capital allowances − balancing allowances | The capital allowance schedule for the year |
| **= Total profits** | **Companies income tax 30%** |
| − withholding tax credits | Deductions customers made in the year, with their credit note (certificate) |
| **= Income tax to pay** (+ the levy) | |

A loss, or allowances greater than profit, is carried to the next year and shown on the page.

## Withholding tax credits

Withholding tax a customer deducted from a payment (recorded on the invoice, VAT part 2c) counts against the income tax once the customer's credit note number is entered.

- **Deductions still waiting for a credit note** are listed with their total and are not used.
- **Credits beyond the tax** carry forward.
- **The levy:** credits come off companies income tax, not the development levy.

## Tax year

Tax year Y is the 12 months ending on the last day of the business's year-end month in Y. It is 31 December unless the business sets another month (`accounting.tax_profile`, set by an Owner or Admin on the page).

For example, with a March year end, tax year 2027 runs from 1 April 2026 to 31 March 2027. Capital allowances follow the same years.

**A small company** pays neither tax nor levy, but still files. It must meet all three conditions:

- turnover (operating revenue for the year) up to ₦50m;
- fixed assets (their carrying amount in the books at the year's end) up to ₦250m;
- not a professional services firm.

The page says which condition a business fails.

## In the books (owner decision of 27 November 2026)

Once the tax year has ended and the estimate is final, the **Owner** posts it, dated the year's last day:

| Debit | Credit |
| --- | --- |
| Income tax expense (7900): income tax + development levy | Income tax payable (2350): what is left to pay |
| | WHT credits (1320): withholding tax used against it |

- **Paying it:** payments to the tax office are recorded against it by an Owner or Admin, from the till or a bank, never more than is owed. Income tax payable has the `income_tax` purpose, so payments appear as "Income taxes paid" in the cash flow statement.
- **Reversing:** the Owner can reverse a payment recorded in error, or the posting itself while nothing is paid on it, with a reason. Each reversal is its own journal dated that day, and the original is kept.
- **Posted figures are fixed.** If the estimate changes after posting, reverse the posting and post again.
- **Records:** `accounting.tax_accrual` and `accounting.tax_payment`, both behind the income tax switch.

## Screen: Accounting › Income Tax Estimate (`/accounting/income-tax`)

- **The menu entry:** held back (`HELD_BACK` in `src/lib/preview.ts`), so only the preview business sees it until release.
- **The page:** shows the year's total due and the CIT and levy, or the small-company result, with every step of the computation.
- **Adjustments:** add back or take off, with a label and amount. A retried request adds nothing.
- **About this year:** losses brought forward, and whether the business provides professional services.
- **Who changes it:** Owners and Admins. Viewers see the estimate.

## API

All need `ledger.view`; changes need an Owner or Admin.

- `GET /income-tax/{year}`
- `PUT /income-tax/{year}`
- `POST /income-tax/{year}/adjustments`
- `DELETE /income-tax/{year}/adjustments/{id}`
- `PUT /income-tax/settings` (year-end month)
- `POST /income-tax/{year}/post` and `POST /income-tax/{year}/reverse` (Owner)
- `POST /income-tax/{year}/payments` (Owner or Admin), and `POST /income-tax/{year}/payments/{id}/reverse` (Owner)

## To confirm before release (tax professional)

1. The small company turnover limit, ₦50m or ₦100m, and whether "fixed assets" means their cost or their carrying amount.
2. The rates (CIT 30%, development levy 4%), that the levy is charged on assessable profit, and that withholding tax credits come off income tax only.
3. Whether a balancing charge is added after losses, as CACU does now, or before.
4. **Not modelled yet:**
   - a business's first or last part year, or a change of year end;
   - the minimum effective tax rate for large companies;
   - tax incentives (such as economic development incentives).
5. Then set `reviewed_at` on `accounting.income_tax_rule` and `accounting.capital_allowance_rate`, and turn the switches on in production.

Sources consulted: Wikipedia (Nigeria Tax Act 2025), EY tax alert, Baker Tilly Nigeria, AnooreHR, Mytax, Techpoint, SOW Professional.
