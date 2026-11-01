# IFRS release review

Status: draft review only. Branch: feat/ifrs-gap-remediation. Target: CACUTECH/CACU main.

## Reviewer walkthrough

1. Read [implementation and rollback guidance](ifrs-controls-implementation-20261101.md), [all 18 gap-register entries](ifrs-gap-register-20261101.csv) and [validation evidence](ifrs-validation-20261101.json).
2. Inspect the migrations in order: `20261101174817_ifrs_inventory_and_reporting_close.sql`, then `20261101174820_ifrs_catalog_valuation_guard.sql`. They add private tenant-isolated controls and preserve existing balances and approval flags.
3. Review the inventory policy/adoption, goods receipt, exact cost allocation, NRV allowance, return/refund and manual-posting boundaries in `backend/cacu/accounting/inventory.py`, `posting.py`, `stock.py` and `catalog.py`.
4. Review gross cash-flow classes, explicit cash eligibility/restrictions and settlement disclosure rules in `reports.py` and `cash_rules.py`.
5. Review the close package, external schedule ties, current portions, OCI/equity changes, independent approvals and stale-review protection in `close.py` and the new Policies workspace.
6. Confirm compatibility of the additive API contract, existing catalogue metadata edits, invoice replay hashes and legacy unadopted stock. Existing commercial rules and email exclusions remain unchanged.

## Validation supplied

- Full Python run: 425 passed before final refinements; 46 affected regressions and 8 final IFRS acceptance tests passed afterwards.
- Frontend: lint/typecheck, 289 tests and production build passed.
- Browser: 50 passed with two workers; latest close-submission/approval-gate test also passed separately. One default-parallel run hit the existing cash-report loading wait; no assertion was weakened.
- Local security audit: seven forced-RLS private tables; no anon/authenticated table access; immutable evidence has no runtime UPDATE/DELETE grant; catalogue guard is not publicly executable.
- GitHub CI must validate the published PR commit before approval.

## Accountant and business review

- [ ] Accountant approves the permitted costing policy for the actual inventory scope. This release implements moving weighted average, not FIFO/specific identification.
- [ ] Owner/Admin approves dedicated unused NRV allowance and dated cash-flow classifications; actual legacy balances and stock reconcile before adoption.
- [ ] Accountant supplies and reviews applicable ECL, asset, lease, tax, employee-benefit, financing, maturity and disclosure schedules. These integrate reviewed calculations; they are not automated measurement engines.
- [ ] Historical revenue performance evidence is reviewed; unsupported advances and over-time contracts are not issued through the completed-sale flow.
- [ ] Pre-cutover/insufficient comparative periods receive separate preparation and further integration. The application blocks approval instead of fabricating comparative figures.
- [ ] IFRS 18 transition plan and period gates are reviewed. Full IFRS 18 presentation and transition comparatives are not implemented by this release.
- [ ] CACU's separate NG-2026.1 template sign-off remains pending until the accountant actually completes it. This PR does not certify IFRS compliance.

## Release gates

- [ ] Approve the exact PR commit and CI results.
- [ ] Verify backup/restore readiness and apply/test both migrations on isolated staging before production adoption.
- [ ] Verify the intended frontend and accounting-backend project/commit/environment; deploy the compatible backend before/together with the frontend.
- [ ] Complete human policy approvals and acceptance tests before enabling adopted valuation or approving a close.

Vercel read-only inspection on 1 November 2026 listed project `cacu` (`prj_dGga8i001xXAcRdLmJB8otPwPQFF`) under team `team_1wa2SWkcHaqsq59sLpjnQI1x`. Detailed inspection returned **403 forbidden**, requiring team-scope reauthorization. The live root directory, backend target, deployment configuration and preview readiness therefore remain unverified. No environment values were fetched, no deployment was requested, and no production migration was applied.

After adoption, an old catalogue-cost writer is not a safe rollback. Suspend affected writes and preserve all valuation/journal/review evidence while rolling forward a reviewed correction; see the implementation guide.
