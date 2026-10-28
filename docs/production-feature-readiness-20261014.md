# Production feature readiness - 14 October 2026

The demo user has an active Owner membership in its isolated Hybrid workspace. Owner grants existing application permissions; it does not activate unfinished modules or bypass tenant isolation. Commercial rules and email delivery remain excluded under the user's decisions.

## Implemented for review

The HR employee directory now uses existing personnel rows, with server-side active Owner/Admin checks and a second authorization check in HRService. Reads are limited to 20 rows, sorted by name and ID, and scoped to the verified active business. Only ID, name, job title, department and employment status are projected. Salary and bank details are excluded. Invalid pages, missing membership and failed reads fail closed; database error messages are not shown to the browser.

The previous HR layout blocked every child page. It is replaced with the role guard. Separate attendance and payroll layouts preserve their unavailable state, including payroll subroutes: legacy payroll screens contain sample-data calculations and must not become production tools. Onboarding and termination retain their existing unavailable screens. The directory is read-only while employee mutation replay/audit contracts are verified. Existing server-action contracts remain unchanged.

Live read-only schema inspection confirmed the directory columns and employee SELECT/INSERT/UPDATE/DELETE policies are restricted to active Owner/Admin memberships. No hosted rows, migrations, grants or policies were changed by this implementation. No application deployment was made.

## Required next steps

- Review this directory change and the existing technical-completion change before deployment. This patch currently depends on the reviewed work in feat/technical-completion.
- Implement employee mutation validation, replay and audit history, then attendance concurrency/date-window behavior. Review the pending attendance database guard before exposing attendance.
- Implement payroll persistence, approvals, accounting posting and reviewed statutory rules. Sample computations are not production acceptance.
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
