# Company income tax estimate (R4, Nigeria Tax Act 2025)

A yearly estimate of companies income tax (CIT) and the development levy, worked out from the books with every step shown, for the owner and their tax adviser. **Nothing posts to the ledger, and CACU files nothing.**

The owner decided, on 26 November 2026:

- **Estimate only.** It sits behind `accounting.income_tax_switch`, which starts off until a tax professional reviews the estimate. It is on for CACU's preview business.
- **Small company turnover of ₦50m,** from the Act's text. The June 2026 transition guidelines and some advisers say ₦100m. The limit is kept in one reviewed row (`accounting.income_tax_rule`), so it changes in one place.

## The computation

| Step | From |
| --- | --- |
| Profit before tax | Every income and expense account for the calendar year |
| + depreciation in the books | Depreciation (6700); replaced by capital allowances |
| − book gain on disposals / + book loss | Gains and losses on disposal (4950); replaced by balancing charges and allowances |
| + expenses the law does not allow, − income that is not taxable | Adjustments the owner enters |
| **= Adjusted profit** | |
| − losses brought forward | Entered by the owner; losses carry forward indefinitely |
| **= Assessable profit** | **Development levy 4%** |
| + balancing charges − capital allowances − balancing allowances | The capital allowance schedule for the year |
| **= Total profits** | **Companies income tax 30%** |

A loss, or allowances greater than profit, is carried to the next year and shown on the page.

**A small company** pays neither tax nor levy, but still files. It must meet all three conditions:

- turnover (operating revenue for the year) up to ₦50m;
- fixed assets (their carrying amount in the books at the year's end) up to ₦250m;
- not a professional services firm.

The page says which condition a business fails.

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

## To confirm before release (tax professional)

1. The small company turnover limit, ₦50m or ₦100m, and whether "fixed assets" means their cost or their carrying amount.
2. The rates (CIT 30%, development levy 4%), and that the levy is charged on assessable profit.
3. Whether a balancing charge is added after losses, as CACU does now, or before.
4. **Not modelled yet:**
   - years that are not calendar years, and part years;
   - the minimum effective tax rate for large companies;
   - withholding tax credits against the tax due;
   - tax incentives (such as economic development incentives).
5. Then set `reviewed_at` on `accounting.income_tax_rule` and `accounting.capital_allowance_rate`, and turn the switches on in production.

Sources consulted: Wikipedia (Nigeria Tax Act 2025), EY tax alert, Baker Tilly Nigeria, AnooreHR, Mytax, Techpoint, SOW Professional.
