# CACU release checklist

All items require evidence for the target environment; previous checked claims were unverified.

- [ ] Current dependencies reviewed; npm security backlog resolved or specifically assessed.
- [ ] Next lint, independent typecheck, Jest and build pass without build bypasses.
- [ ] Python lock audit and tests pass; generated contracts match OpenAPI.
- [ ] Reviewed schema-only baseline and additive upgrades reproduce fresh/existing installs.
- [ ] Membership revocation, multi-business selection, direct privileged RPC calls and viewer writes tested against real SQL.
- [ ] Tenant-consistent foreign keys, grants, RLS and fixed function search paths verified live.
- [ ] Canonical journals balance at database boundary; immutable posted entries and closed periods enforced.
- [ ] Document/journal/audit/stock effects roll back atomically; idempotency and concurrency tests pass.
- [ ] Invoice partial payments do not recognize revenue again; AR/AP/stock reconcile to control accounts.
- [ ] Deterministic NGN fixture and failure rollback tests produce required totals against Postgres.
- [ ] Storage SELECT/INSERT/UPDATE permits only authorized business-assets replacements.
- [ ] Browser flows, expiry, downloads, pagination and empty/error states verified on both previews.
- [ ] Provider status, payroll/tax/compliance and scale claims supported independently.
- [ ] Exact Vercel team/projects/environments confirmed; existing production domain preserved.
- [ ] Backups restored in isolation; historical reconciliation and release rollback reviewed.

See implementation-checkpoint.md for actual observed results. Mock tests do not complete database gates.