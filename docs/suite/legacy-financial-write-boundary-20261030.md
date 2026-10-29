# R0 legacy financial write boundary - implementation review

## Scope

Docs 07/08 M-02 and M-04: GAP-01, GAP-02 and GAP-06, plus verification of GAP-03. This follows the plan in [the suite review](repository-review-20261029.md) and [business-history retention](business-history-retention-20261029.md). It does not claim gate G1: point-in-time recovery, the restore drill, the schema baseline, credential rotation and leaked-password protection remain owner actions.

## Production findings (read-only, 29 October)

- `authenticated` held INSERT, UPDATE, DELETE and TRUNCATE on all eleven legacy financial tables: `financial_transactions`, `transactions`, `transaction_items`, `journal_entries`, `journal_lines`, `invoices`, `invoice_items`, `payments`, `payment_events`, `payment_status_history`, `accounts`. With member-level policies such as `financial_transactions_insert` (any member), any signed-in member, including viewers, could create legacy financial rows through the Data API.
- `cacu_runtime` is not a member of `authenticated` and holds its own grants, so revoking `authenticated` does not affect the Python core.
- No caller-rights function writes these tables, and nothing writes `accounts`. The legacy writers (`process_sale_safe`, `create_invoice_atomic`, `record_payment_atomic`, `management_write`) are SECURITY DEFINER with fixed search paths.
- GAP-03 is already closed by grants: `authenticated` has no table or column UPDATE on `catalog_items`, so the editor policy Doc 08 flagged is inert. This change adds a regression test and no migration.
- `accounting.immutable_ledger` had no fixed search path (GAP-06). Its body uses only built-in functions.
- Only two app paths wrote directly: `LedgerService.recordEntry` (insert plus a separate, non-atomic audit call) and `InvoiceService.updateInvoiceStatus` (any status string, TD-007).

## Change

Migration [20261030100000_legacy_financial_write_boundary.sql](../../supabase/migrations/20261030100000_legacy_financial_write_boundary.sql):

- Revokes INSERT, UPDATE, DELETE and TRUNCATE on the eleven tables from PUBLIC, anon and authenticated. SELECT and existing read policies are unchanged. Existing policies are left in place and are inert without grants.
- Pins `accounting.immutable_ledger` to `search_path = pg_catalog, pg_temp`.
- Adds `record_ledger_entry_safe`: Owner/Admin/Editor only, refused for businesses on the native ledger, validates description, type, amount (above zero, kobo precision) and date (not in the future, business timezone), writes the entry and its `audit_logs` row in one transaction, and replays a retried request key (`legacy_private.ledger_requests`). A reused key with a different payload is refused.
- Adds `update_invoice_status_safe`: Owner/Admin/Editor only, allows only draft to sent and draft, sent or overdue to void, refuses voiding an invoice with payments, and audits the change. `paid` stays with `record_payment_atomic`.

App: the ledger service and screen send a request key kept until the entry is confirmed or definitely refused, and report uncertain failures as retryable. The invoice service calls the new function; accepting an estimate now says it is not available instead of failing silently.

## Finding not fixed here

The invoice screen creates documents with status `Pending` or `Paid` and converts estimates to `Accepted`, but the hosted `invoices_status_check` allows only `draft`, `sent`, `paid`, `overdue` and `void`, and `create_invoice_atomic` passes the status through. Legacy invoice creation therefore fails in production (0 invoices exist). Fixing it changes money flows and needs its own reviewed change.

## Verification

- `backend/tests/test_legacy_write_boundary_postgres.py`: 23 cases on disposable PostgreSQL with hosted-style grants (TEST-012 for every table; TEST-001/003-style denial for viewers and other tenants; replay; validation; cutover refusal; invoice transitions; GAP-03 stock denial; GAP-06 search path).
- Full backend suite: 255 passed, 16 skipped. Jest: 259 passed in 34 suites. Browser components: 35 passed. TypeScript, changed-file ESLint and the production build passed.

## Release steps

1. Review. Apply to staging first when it exists; production apply is a human release step with a recorded backup point.
2. Before applying, confirm production still matches the findings above (grants, `cacu_runtime` independence, no caller-rights writers).
3. After applying: `has_table_privilege('authenticated', <table>, 'INSERT')` is false for all eleven tables; a ledger entry from the Transactions screen succeeds and shows one audit row; the Python core health and report endpoints still work.

Rollback is application-only. Do not re-grant direct writes; correct forward.
