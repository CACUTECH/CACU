# R0 business-history retention - implementation review

## Problem and scope

Docs 07/08 GAP-10 and the next-step plan in [the suite review](repository-review-20261029.md) identify direct deletion of a business as a data-loss path. The user authorized beginning implementation after reviewing that plan. This patch implements the business-parent portion of M-01; it does not claim all R0 release gates, other financial-parent cascades, the schema baseline or the full blueprint are complete.

Read-only production catalogue checks on 29 October confirmed RLS is enabled on public.businesses, businesses_delete_owner_only is present, and 26 foreign keys cascade from businesses: 25 public references plus onboarding_private.business_requests. Other inspected references, including accounting, already use NO ACTION. No hosted data rows or credentials were read, no production writes were made and the migration has not been deployed.

The new local migration is [20261029143527_retain_business_history.sql](../../supabase/migrations/20261029143527_retain_business_history.sql). Its version/name were created by the Supabase CLI. Existing applied migrations are untouched.

## Change

- Revoke DELETE and TRUNCATE on businesses from PUBLIC, anon, authenticated and cacu_runtime. This also covers empty businesses, where no child foreign key could block deletion.
- Remove the owner-delete policy and add a restrictive DELETE policy for application Auth roles. An accidentally reintroduced permissive policy or DELETE grant cannot override the restrictive policy while RLS remains enabled.
- Discover all top-level foreign keys targeting businesses with ON DELETE CASCADE, including private-schema references. Replace only their delete action with RESTRICT, preserving names, referenced columns, MATCH and UPDATE behavior, deferrability, existing validation state and constraint comments. NO ACTION and pre-existing RESTRICT references are unchanged.
- Use one transaction, a 5-second lock timeout and a 60-second statement timeout. Newly recreated constraints are added NOT VALID, then validated in the same transaction only when the original was validated. Previously NOT VALID constraints retain that state. No row is rewritten or deleted.
- Refuse unsupported partitioned/inherited relation types or unexpected constraint definitions rather than silently skipping protection. Any error rolls back grants, policy and every constraint change.

PostgreSQL requires replacing a foreign key to change its delete action. RESTRICT prevents a referenced parent from being deleted; it is not a business closure workflow. See [constraint actions](https://www.postgresql.org/docs/17/ddl-constraints.html) and [ALTER TABLE / validation locking](https://www.postgresql.org/docs/17/sql-altertable.html).

## Compatibility and limits

Existing application services have no business deletion workflow in the inspected source. Business reads, Owner/Admin metadata updates, atomic setup and Owner membership creation remain available. Inventory/user-management, native posting, invoices, uploads and HR code are unchanged. Existing users, roles, stock, documents, journals, replay/audit rows and business IDs are preserved. No commercial, email, AI, provider or environment setting changes.

The migration does not prevent a privileged administrator from deliberately deleting child rows, dropping constraints or truncating with superuser authority. Do not give application credentials ownership, superuser or BYPASSRLS. Revoking browser deletion is not a substitute for backups, restore drills or a reviewed closure/retention process. Direct legacy financial/stock DML (GAP-01/02/03) and non-business financial-parent cascades are separate follow-ups.

The missing pre-0001 schema baseline remains unresolved. The tests use explicitly guarded disposable fixtures with actual PostgreSQL grants/RLS/FKs and real existing command migrations; they are not a full hosted-schema restore or PostgREST/HTTP acceptance test.

## Review, staging and release steps

1. Review the source migration and tests. Obtain the reviewed schema-only baseline and isolated staging project for full upgrade/restore acceptance. Record a restorable backup point before the human production release.
2. Re-query the current target catalogue and migration history. This CLI-generated 29 October version sorts before the repository's existing future-dated 20261030090000 HR migration. On already-upgraded targets, explicitly review the migration runner's ordering plan; never rename an applied migration, repair history blindly or apply every pending file indiscriminately. This migration does not depend on HR and is compatible before or after its current definitions.
3. Rehearse on synthetic staging data. Inventory cascade count and relation kinds; check orphan/NOT VALID constraints. Measure lock waits and validation scans with representative sizes. The transaction holds DDL locks until commit; timeout protection is not proof of acceptable production latency. If 60 seconds is insufficient, stop and split a separately reviewed validation rollout; do not remove timeouts in production without review.
4. Run the recorded real PostgreSQL tests, setup, management, invoice/receipt/posting and HR regressions, then staging signed-in read/update/setup and direct Data API DELETE/TRUNCATE denial. Apply production changes only through the human release process, during a reviewed window.
5. Verify zero business-targeting cascade references, unchanged row/control totals, denied application DELETE/TRUNCATE, active restrictive policy and preserved read/update behavior. Existing validated constraints should remain validated; pre-existing NOT VALID ones should not be silently changed.

Read-only verification queries:

```sql
SELECT conrelid::regclass, conname, confdeltype, convalidated
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'public.businesses'::regclass
ORDER BY conrelid::regclass::text, conname;

SELECT role_name,
       has_table_privilege(role_name, 'public.businesses', 'DELETE') AS can_delete,
       has_table_privilege(role_name, 'public.businesses', 'TRUNCATE') AS can_truncate
FROM (VALUES ('anon'), ('authenticated'), ('cacu_runtime')) AS roles(role_name);

SELECT polname, polcmd, polpermissive, pg_get_expr(polqual, polrelid)
FROM pg_policy WHERE polrelid = 'public.businesses'::regclass;
```

Expected: no confdeltype c; application privileges false; businesses_preserve_history restrictive DELETE USING false; old owner-delete policy absent. Other legitimate read/update policies remain.

## Rollback / forward correction

A failed migration transaction rolls itself back, with all rows and original grants/policies/constraints intact. After successful rollout, application code can roll back independently: retain the restrictive constraints and policy. Do not re-enable cascades or broad business deletion as an application rollback. If a legitimate closure process is needed, design a reviewed archive/retention workflow with explicit approvals rather than deleting business history. No data rollback is required.

## Validation

Final validation: full backend `python -m pytest -q --disable-warnings` passed **248 tests with no skips**, with all three disposable PostgreSQL DSNs enabled (397 warnings reported; dependency/fixture warnings were not remediated in this patch). The frontend `npm run ci` command exited zero, covering lint, TypeScript and the unchanged 258-case unit suite; the remaining lint warnings are in existing code. The production build using the private .env passed. All **35 browser component tests** passed, using existing explicit server-action doubles rather than hosted data. `git diff --check` passed for the task files. No dependency, CI, application endpoint or production configuration changed.

There are 21 new real-PostgreSQL cases: 20 retention cases plus one setup compatibility case. Initial compatibility assertions were corrected to use the existing native stock command for active-ledger businesses, expect the legacy replayed flag, and normalize JSON UUID strings; the application guards were not relaxed. The full backend suite passed after those corrections. Added tests reproduce owner cascade deletion before the migration; verify all 26 conversions and exact fixture row preservation; deny Owner/Admin/Editor/Viewer/deactivated/outsider deletion and application TRUNCATE; test accidental grant/policy reintroduction, privileged parent-delete restriction, owner read/update and foreign-tenant denial, quoted identifiers/constraint attributes, timeout/failure rollback, empty business protection, atomic setup/owner/retry and correct native/legacy stock/replay workflows.
