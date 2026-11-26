# CACU's preview business

The owner decided, on 26 November 2026, that one business, chosen by CACU, sees every CACU feature before it is released to everyone. Its members see:

- **Every module in the menu**, including those still held back for other businesses: HR, Credit, Community, Integrations, Storefront and the Income Tax Estimate. Credit, Community, Integrations and Storefront still open on their "not available yet" screens, because nothing behind them is built.
- **Features behind CACU's own switches**, on for this business only: payroll posting (`accounting.payroll_switch`), funding readiness (`accounting.funding_switch`) capital allowances (`accounting.capital_allowance_switch`) and the income tax estimate (`accounting.income_tax_switch`). Both stay off for everyone else until their release gates.

**Plan limits and billing are unchanged.** For example, funding readiness still shows only what the business's plan includes.

## How it works

- `accounting.preview_business` lists the business. Nobody can add to it through the app: the API runtime and signed-in users are both refused. Adding a business is a reviewed production change.
- `accounting.is_preview(business)` is checked by each CACU switch as well as its own setting:
  - payroll posting checks it in `payroll._enabled`;
  - funding readiness checks it in `accounting.funding_access`, the monthly queue and lender pack links;
  - capital allowances check it in `allowances.enabled`;
  - the income tax estimate checks it in `income_tax.enabled`.
- `public.cacu_preview(business)` tells the app's menu whether to show held-back modules. It answers only to the business's own active members.

## Later features

The same two places cover features added later:

- **A module held back from the menu:** add it to `HELD_BACK` in `src/lib/preview.ts`.
- **A new CACU switch:** check `accounting.is_preview(business)` alongside it.

## Marking the business (production)

Run once, with approval:

```sql
INSERT INTO accounting.preview_business(business_id, reason) VALUES ('<business id>', 'CACU preview and demo business');
```

To remove it, delete the row.
