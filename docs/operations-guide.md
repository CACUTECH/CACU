# Operations gates

This branch is a development checkpoint, not a production accounting release.

Before schema changes: obtain reviewed schema-only baseline; retain an encrypted platform backup; perform a restore into an isolated database and compare schema, row counts and control totals. Never reset production or apply docs/supabase_schema.sql. Review additive migration SQL and privilege changes separately from runtime application rollout. Do not run migrations at cold start.

Historical reconciliation: export existing financial_transactions/source documents for authorized review; map existing accounts explicitly, list unmapped or inconsistent rows, choose and document the cutover date, compare trial balance and AR/AP/stock control totals. Do not invent offset accounts or use a suspense plug. Retain original IDs and audit links.

Period closing: reconcile bank/AR/AP/inventory, resolve exceptions and freeze postings with database period guards. Reopening requires an authorized, audited transition. Native period validation and deferred database posting-period guards are delivered in the staged migrations. Period-opening/reopening approval and audit procedures still require an explicit operational workflow.

Release: lint/typecheck/Jest/Python/database/browser checks must pass; use non-secret fixtures for PR jobs. Confirm exact team/project/environment; deploy both previews and prove authenticated UI->API->database behavior, uploads/downloads, redirects, expiry and no cross-tenant effects. Existing domain remains unchanged until explicit cutover authorization.

Rollback: keep the preceding application deployment available, use backward-compatible additive schema changes, disable new write paths if validation fails and reconcile durable idempotency keys/source effects before replay. Never restore an old database over new posted transactions without a reviewed recovery plan.