# Legacy invoice creation and definer access - implementation review

## Scope

Fixes the production defect found in the write-boundary review: every legacy invoice creation failed. Also Doc 08 GAP-07. Builds on `20261030100000_legacy_financial_write_boundary`, which must be applied first.

## Findings (production, read-only, 29 October)

- `invoices_status_check` allows `draft`, `sent`, `paid`, `overdue` and `void`. The invoice screen sent `Pending` (invoices, estimates) or `Paid` (receipts), and `create_invoice_atomic` passed status, number, prices, subtotal, tax and total through from the browser. Creation therefore always failed. Had the check been looser, a browser could have created an invoice marked paid with no payment, or priced away from the catalogue (BR-003).
- 0 invoices exist, so no data needs correcting.

## Change

- Migration `20261030110000_legacy_invoice_creation.sql` adds `create_invoice_safe`:
  - Owner, Admin or Editor only. Refused for businesses on the native ledger.
  - Invoices and estimates only. Receipts come from recording a payment; credit notes are R2 (FR-110).
  - The server sets the status (`sent` for invoices, so they can take payments; `draft` for estimates), the number (`INV-000001`, `EST-000001`, sequential per business under an advisory lock), each line's catalogue price, and the totals.
  - Invoices need a customer from the same business. Items must be active and in the same business. Quantities are above zero with at most 3 decimals. The issue date cannot be in the future, and the due date cannot be before it.
  - VAT is refused until tax is configured (ACC-015).
  - The invoice, its lines, an `INVOICE_CREATED` audit row and the request-key record commit together. A retry replays the first result; a reused key with changed details is refused.
  - Signed-in users can no longer execute `create_invoice_atomic`.
- Migration `20261030120000_definer_function_access.sql` revokes `record_audit`, `process_sale` and `adjust_inventory_stock` (inventory in [definer-function-inventory-20261030.md](definer-function-inventory-20261030.md)).
- App: the invoice service sends only item IDs and quantities. The form shows catalogue prices read-only and VAT off. The Receipts and Credit memo tabs explain how those documents are created instead of opening a form.

## Verification

- `test_legacy_invoice_creation_postgres.py` (19 cases) and `test_definer_access_postgres.py` (2) on disposable PostgreSQL. Full backend: 276 passed, 16 skipped.
- Jest 264 passed in 34 suites. Browser components 35 passed. TypeScript, ESLint on changed files and `next build` passed.

## Release steps

1. Apply after `20261030100000`, as a person, with a recorded backup point.
2. After applying: `has_function_privilege('authenticated', <fn>, 'EXECUTE')` is false for `create_invoice_atomic`, `record_audit`, `process_sale` and `adjust_inventory_stock`. Creating an invoice from the screen gives `INV-000001` with status `sent` and catalogue prices. Recording a part payment leaves it `sent`; paying the rest marks it `paid`.
3. Re-run the Supabase security advisor; the definer list should match the inventory.

Rollback is application-only. Do not re-grant `create_invoice_atomic`.
