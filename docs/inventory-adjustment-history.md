# Inventory adjustment history

Open Catalog or Inventory, select a product and choose View. Opening stock and adjustments lists saved quantity corrections and opening records, with their effective date, reason, quantity change, before/after stock and recorded actor/time. Entries are paginated newest first, with UUID ordering to keep identical timestamps stable. Services do not show stock history. Archived products retain their saved history.

This is a read-only view of existing `inventory_movements`, not a reconstructed or complete stock ledger: sales remain in transaction history and old activity not recorded in this table is not invented. No balances, journals, invoices, users or historical rows are modified.

Reads reuse the current verified-user/active-business service context. The server validates item IDs and bounded pages, checks that the item belongs to the selected business, and filters both item and movement queries by that business. Existing RLS checks active membership again at the database. No service-role client or extra privileged grant is introduced. The UI clears rows during pagination/retry and ignores late responses after changing items or closing the view.

## Setup and rollback

No new environment variable, dependency or migration is needed. The existing inventory/user-management migration `20261012140639_inventory_user_management.sql` must already be installed, as required by the parent implementation. Deploy the reviewed application change using the existing environment. If history cannot be loaded, confirm that migration and the user's active membership; do not broaden table grants or bypass RLS.

Rollback only this application commit to remove the view. Keep existing tables, movements and stock/accounting authorization safeguards. Email delivery remains unimplemented by user choice; commercial packaging, tax rules and provider configuration are unchanged.

## Validation

Service regressions check ownership, business filters, stable ordering, pagination bounds, invalid identifiers and failure behavior. Browser tests cover mobile presentation, pagination, retry and a late response for a previous item. A disposable PostgreSQL test verifies the actual movement SELECT policy for an active Viewer, an outsider and the same Viewer after deactivation. No hosted database writes or live provider calls are performed.

Results: 127 Jest tests, 19 browser tests and the focused real PostgreSQL permission regression passed. TypeScript and the production build using the private `.env` passed. Lint reports 0 errors and 241 existing warnings. Backend posting logic and database schema are unchanged; the new backend test only verifies existing SELECT permissions.
