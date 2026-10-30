# R1 default chart of accounts - implementation review

## Scope

Doc 09 section 4 (default chart), ACC-012 (purpose mapping), DEC-004 (Owner/Admin adopts), Doc 03 FR-131 (read view), Doc 12 SCR-19, Doc 16 country module "chart template". Second Phase 2 item. Builds on the R0 honest-screens branch, which replaced the browser-only chart prototype.

## Findings

- Provisioning (`tools/provision_entity.py`) maps rows of `public.accounts` to purposes, but no business has any accounts (production: 0 rows), and nothing creates them.
- Posting looks up exactly one account for each of `cash`, `revenue`, `equity`, `inventory` and `cogs`; `bank` may have several. The catalogue opening-stock posting uses `equity`, where Doc 09 names the account "Opening balance equity" (`opening_balance`).
- `businesses` has no timezone column; provisioning defaults to `Africa/Lagos`.

## Change

- Migration [20261031100000_default_chart_of_accounts.sql](../../supabase/migrations/20261031100000_default_chart_of_accounts.sql):
  - **Template.** A private, versioned template `NG-2026.1` holds the R1 accounts from Doc 09: 28 for product and hybrid businesses, 24 for service-only. Each row has the CACU type, the python-accounting type, the purpose and the cash-flow section. The template starts as `pending_review`.
  - **Checks on the template.** The database enforces one account per single-use purpose for each mode, and that cash and bank accounts are BANK type in the cash section.
  - **`adopt_default_chart`.** Owner or Admin only. It copies the template for the business's mode into `public.accounts` and records the adoption and an audit row. Calling it again returns the first result. It is refused once books are provisioned or active, or when the business already has accounts.
  - **`chart_of_accounts`.** Any active member can read the accounts with their purposes and the template's review status. Purposes come from the reviewed mapping once the books are provisioned.
- `backend/cacu/accounting/chart.py` checks a chart against the provisioning and posting rules. `tools/default_chart_mapping.py` builds a business's provisioning mapping read-only, with customers mapped to 1100 and suppliers to 2000, for `provision_entity.py`. Both refuse a template that is still `pending_review` unless `--staging-unreviewed` is given.
- `/accounting/chart-of-accounts` shows the accounts grouped in plain language (UX-02), with what each is used for and the review status. It offers "Set up standard accounts" to Owners and Admins, and keeps its retry key until the accounts are confirmed. Editing accounts is not offered (FR-131 edits come with the core's chart endpoints).

## Departures from Doc 09 for the reviewer (DEP-02)

1. 3900 Opening balance equity carries the purpose `equity`, which the current code uses, instead of `opening_balance`.
2. Service-only businesses post sales to 4100 Service income. Hybrid businesses post all sales to 4000 until goods and service revenue are split.
3. All equity accounts use the `financing` cash-flow section, as the existing fixtures do. How opening balances appear on the first cash-flow statement is settled with "Start your books".
4. 1020 Transfers awaiting confirmation is included, but nothing posts to it until the BL-024 transfer decision.
5. R2 to R4 accounts (1030, 1310, 1320, 1500, 1590, 2010, 2100, 2200, 2210, 2300, 2310, 6700) arrive in later template versions.

## Review sign-off

The accountant reviews `NG-2026.1` and the points above. If changes are needed, they go into a new version (`NG-2026.2`); an adopted version is never edited. Recording the sign-off is a reviewed migration that sets `status = 'reviewed'`, `reviewed_by` and `reviewed_at`.

## Verification

- `test_default_chart_postgres.py` (12 cases). It covers:
  - product and service adoption, with the right accounts, purposes and audit row, and a retry that adds nothing
  - Editors, Viewers and other businesses refused
  - businesses with books or existing accounts refused
  - members can read the chart and other businesses cannot
  - the template is private, and every mode passes the provisioning checks
  - the mapping refuses an unreviewed template and builds a valid staging mapping
  - the checks reject charts that could not be posted to
- Full backend 298 passed, 16 skipped. Jest 280 passed in 36 suites. Browser components 39 passed (adds the chart page at 360 px with a retried adoption). TypeScript, ESLint on changed files and `next build` passed.

## Release steps

Apply after `20261031090000`. Adopting is safe for any business; nothing posts to the accounts until the template is reviewed and the books are started.
