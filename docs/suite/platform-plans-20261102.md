# Plans and entitlements (Phase 3, M-09 part 1)

This is the first Phase 3 (R2) item: CACU's own plans, limits and subscriptions in a new `platform` schema (Doc 14, Doc 07 M-09). It follows the owner's plan decision in `plans-decision-20261102.md`: General ₦1,500, Oga ₦6,000 and Chairman ₦15,000 a month, with Hybrid on Chairman only and no free plan.

## What it adds

Migration `20261102100000_platform_plans.sql`:

- **`platform.plans` and `platform.plan_entitlements`:** the three plans and Doc 14's entitlement matrix, stored as data.
  - Prices are held in kobo.
  - JSON `null` means unlimited.
  - Staff edits are logged to `platform.config_changes` (SUB-R04).
  - Annual prices stay empty until they are confirmed.
- **`platform.subscriptions`:** one row per business, with eight statuses:
  - `trialing` and `incomplete` come before `active`;
  - `past_due` and `grace` keep full access;
  - `suspended`, `cancelled` and `closed` are read-only.
- **`platform.subscription_changes`:** an append-only record of every change. Each write must set `platform.actor_kind` and `platform.reason` in its transaction, or it is refused. Subscriptions are never deleted.
- **Checks:**
  - `platform.entitlement(business, key)` is the single place the app asks what a business's plan allows. SQL `NULL` means the business has no subscription yet.
  - `platform.writes_allowed(business)` says whether the business may still record new work.
- **Hybrid rule:** a trigger on `public.businesses` refuses a mode the plan doesn't include. It covers the browser, the API and direct Data API writes. A matching trigger on subscriptions refuses a move to a plan without Hybrid while the business is still in Hybrid mode (SUB-06).
- **Reading plans:** `public.billing_plans()` returns the plans for the plan picker. `public.business_plan(business)` returns a business's own plan to its active members. Tenant roles have no access to the tables themselves (SUB-R02).

The app now explains the refusal ("Hybrid mode is on the Chairman Plan only"), and the placeholder plan names in `subscription-guard.tsx` are now the plan codes.

## Deliberately unchanged

A business with no subscription row is unbilled and works exactly as today. Enforcement starts per business when its subscription is created, so applying the migration changes nothing for existing businesses.

## Next slices

1. Paystack checkout and verified activation (SUB-02, SUB-03), with `platform.billing_events`, CACU invoices and receipts. This needs the Paystack test keys.
2. Renewal, grace, suspension and the scheduled jobs (SUB-04, SUB-08 to SUB-10).
3. Limit checks for users, outlets and catalogue items (TEST-209), and usage counters for AI and messages (TEST-210).
4. The billing screen under Settings.

## Open owner decisions

- **Trial:** Doc 14 proposes a 14-day Oga trial that ends on General. The blueprint proposed no trial.
- **Annual prices:** ₦60,000 for Oga and ₦150,000 for Chairman are proposed.
- **VAT:** are prices VAT-inclusive, and is CACU registered?
- **Existing businesses:** which plan they move to, and with how much notice.

## Tests

`backend/tests/test_platform_plans_postgres.py` has 18 cases covering:
- prices and the Hybrid rule;
- unbilled behaviour;
- Hybrid refused below Chairman, including through the Data API;
- downgrade ordering;
- read-only states;
- explained, append-only history;
- audited limit edits;
- member-only reads.
