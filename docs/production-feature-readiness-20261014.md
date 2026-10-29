# Production feature readiness - 14 October 2026

The demo user has an active Owner membership in its isolated Hybrid workspace. Owner grants existing application permissions; it does not activate unfinished modules or bypass tenant isolation. Commercial rules and email delivery remain excluded under the user's decisions.

## Implemented for review

The HR employee directory now uses existing personnel rows, with server-side active Owner/Admin checks and a second authorization check in HRService. Reads are limited to 20 rows, sorted by name and ID, and scoped to the verified active business. Only ID, name, job title, department and employment status are projected. Salary and bank details are excluded. Invalid pages, missing membership and failed reads fail closed; database error messages are not shown to the browser.

The previous HR layout blocked every child page. It is replaced with the role guard. Separate attendance and payroll layouts preserve their unavailable state, including payroll subroutes: legacy payroll screens contain sample-data calculations and must not become production tools. Onboarding and termination retain their existing unavailable screens. The directory is read-only while employee mutation replay/audit contracts are verified. Existing server-action contracts remain unchanged.

Live read-only schema inspection confirmed the directory columns and employee SELECT/INSERT/UPDATE/DELETE policies are restricted to active Owner/Admin memberships. No hosted rows, migrations, grants or policies were changed by this implementation. No application deployment was made.

## Business mode (28 October)

Owners and Admins choose Product, Service or Hybrid mode in Business Settings. The choice is saved on the business row, so it applies on every device. The previous settings card saved only to browser storage and never changed the workspace. Saves compare against the mode the user saw, so a change made elsewhere is not overwritten. Retrying after a lost response is safe, and the selector keeps the exact change for retry until the result is confirmed. POS is hidden in Service mode; appointments and work orders are hidden in Product mode. The sidebar, mobile navigation, dashboard quick actions and server-rendered route layouts follow the saved mode. Existing records are never deleted when the mode changes.

Mode is a workspace layout choice, not a permission boundary: server actions keep their existing role and tenant checks. Unused demo-tenant visibility code containing a hardcoded business ID was removed before commit. Core identity fields on Business Settings are not persisted and are now shown as read-only rather than presenting a save that did nothing. The legacy payroll screen still reads the old browser-stored value, but it remains behind the unavailable payroll layout.

Validation: 216 unit tests (45 new mode cases), 26 browser regressions, TypeScript, changed-file ESLint (0 errors) and the production build passed. No schema, policy, dependency or hosted data changed; hosted acceptance of the businesses update policy for Admin members remains to be confirmed.

## Dependency security update (28 October)

Targeted upgrades for open advisories; no blanket upgrades:

- `next` 15.5.27 → 15.5.28 (with `eslint-config-next` and `@next/eslint-plugin-next`): unauthenticated RCE in the image optimization API with SVG files (critical) and a Server Actions DoS (high).
- `dompurify` 3.4.16 → 3.4.17 (via `jspdf`): sanitizer bypasses (critical/high/low).
- `postcss-selector-parser` 6.1.4 → 6.1.5: quadratic parsing CPU exhaustion (moderate).
- `zod` 3.25.76 → 4.6.7 with `@hookform/resolvers` 4.1.3 → 5.9.1: memory exhaustion on oversized constrained collections (high). There is no patched 3.x release. Current schemas validate only strings, enums and objects; the setup form's `required_error` moved to the v4 `error` option.
- Backend `Pillow` 12.3.0 → 13.0.0 (38 advisories; the upload worker decodes user images) and `certifi` 2026.7.22 → 2026.10.19.

Remaining: 7 low-severity npm findings come from `deepmerge` 4.3.1 under Jest. They are dev-only test tooling, and no patched `deepmerge` release exists. Re-check when one is published rather than downgrading Jest as `npm audit fix --force` suggests.

Validation: TypeScript, 216 unit tests, 26 browser regressions and the production build passed. 60 backend tests passed, including all 30 upload-sanitizer tests on Pillow 13. 142 PostgreSQL-dependent backend tests skipped without a disposable database. Alerts on the default branch close once this branch is merged.

## HR workflows (29 October)

Owners and Admins can now add and edit employees, change status (Active, On leave, Suspended), record departures and rehire, check staff in and out, and run monthly payroll. Every change goes through `public.hr_write` (migration `20261029090000_hr_workflows.sql`). That command checks the active Owner/Admin membership, validates each field against an allowlist, compares versions, replays a retried request key without applying it twice, and writes a private audit row. Direct client writes to `employees` and `attendance` are revoked. Employee pages show who changed which fields and when; the values stay in the private audit.

- **Attendance:** each employee can have one open shift; only Active staff can check in. Status changes and departures are refused while a shift is open. Dates follow the business timezone (Lagos by default), and existing rows were backfilled with a work date.
- **Payroll:** pay is annualised, taxed in bands, then divided by 12, with each amount rounded to the kobo. Defaults:
  - Nigeria Tax Act 2025 bands: ₦800k at 0%, then 15/18/21/23/25% up to ₦3m, ₦12m, ₦25m, ₦50m and above.
  - Rent relief of 20% of declared rent, capped at ₦500k.
  - Pension of 8% from the employee and 10% from the employer, on basic + housing + transport.
  - NHF at 2.5% of basic, opt-in only.
  - NHIS as a monthly amount set per employee.
- **Excluded from the defaults:** a separate minimum-wage exemption, because sources disagree and the zero band covers most minimum-wage pay.
- **Unreviewed defaults:** runs built on them can be created but not approved. An Owner or Admin must confirm the rules first, which records them as the reviewer. Each run keeps a copy of the rules it used.
- **Run contents:** employees without basic pay and those who departed during the month are listed as not included, rather than paid.
- **Approved payroll** is immutable (enforced by database triggers). It is not posted to accounting or paid out.
- **Legacy screens removed:** the payroll config, loans, pension-remittance, reports and tax-schedule screens used sample data and have been deleted. Onboarding now redirects to Add employee, and departures are recorded on the employee record. AI letters remain unavailable.

The legacy `payroll_runs`/`payslips` tables are untouched. New payroll data is stored in `hr_payroll_rules`, `hr_payroll_runs` and `hr_payslips`. The migration adds employee pay columns with `ADD COLUMN IF NOT EXISTS`; confirm that the hosted `employees` table has no conflicting column types before applying it.

Validation:
- Backend: 210 tests passed against local disposable PostgreSQL 17, including 24 new HR command, permission and payroll cases. Payroll was checked against a hand-worked example (₦500k gross: PAYE ₦62,420, net ₦401,580) and a case spanning all six bands. 16 tests skipped.
- Frontend: 249 Jest tests (33 new HR cases), 26 browser regressions, TypeScript, changed-file ESLint (0 errors) and the production build all passed.
- Not done: the migration has not been applied to hosted Supabase, and nothing was deployed.

## Required next steps

- Review this directory change and the existing technical-completion change before deployment. This patch currently depends on the reviewed work in feat/technical-completion.
- Apply `20261014083939_restrict_hr_data_access.sql`, then `20261029090000_hr_workflows.sql`, on staging and then hosted Supabase after review. Both depend on `20261012140639_inventory_user_management.sql`.
- Have a tax adviser confirm the payroll defaults, including state-specific PAYE administration and whether a minimum-wage exemption applies, before the first approval. Payroll payment, remittance schedules and accounting posting are not implemented.
- Privately configure the approved OpenAI key and model in the frontend Vercel project, then complete real-model evaluations and permission/context review before activation. A ChatGPT subscription is not an API credential.
- Configure restricted accounting runtime login credentials and verified database TLS certificate; Owner/Admin must approve actual opening balances, bank/account-purpose mappings and reconciliation before accounting activation. Do not activate by inventing balances or changing a flag.
- Storefront, provider integrations, community and offline access require their own production workflows, permissions and acceptance tests. They remain unimplemented, rather than account permission restrictions.

## Compatibility and rollback

No dependencies, schema or business data changed. Restore the previous HR layout and employee page to hide the directory; stored personnel, payroll and accounting records remain intact. Keep existing Owner/Admin database policies and pending attendance protection. Do not roll back by relaxing RLS.

## Validation

### 28 October follow-up

The production build passed using the existing private environment configuration.

Reviewed the pending directory implementation and fixed two boundary cases: missing response rows fail closed, and the last supported page cannot generate an invalid next-page link. Added regression coverage for both. All 171 unit tests and 26 browser regressions passed; TypeScript passed. Repository ESLint passed with zero errors and 236 warnings when generated Python `.pytest_cache` folders were excluded because their filesystem permissions prevented traversal. Browser checks use component/action doubles and do not establish hosted acceptance. Payroll and attendance remain guarded; no deployment or hosted data changes were made.

169 unit tests passed, including 27 new directory/access-boundary cases. All 26 existing browser regressions passed (component/action doubles, not hosted acceptance). TypeScript passed. Changed-file ESLint reported zero errors and one pre-existing any warning in HRService.addEmployee. Production build using the existing private .env passed. Payroll/attendance remain guarded. No live model requests, emails, charges or accounting entries were created.
