# R1 Supplier bills and payments - implementation review

## Scope

This item covers PR-18 (supplier bill), PR-19 (supplier payment), and the Doc 10 bill states (unpaid, part paid, paid). It adds the bills screen that the opening bills from Turn on the books were waiting for.

Doc 11 lists purchasing as R2. This R1 version records bills for expenses only; goods bought for stock need a goods receipt with quantities, which comes with purchasing (R2).

It also fixes a defect found while building it: customers and suppliers added after the books went live could not be invoiced or billed.

There is one migration, `20261101120000_supplier_bills.sql`. If Supabase records it under a different version when it is applied, rename the file to match.

## Change

- **Mapping new customers and suppliers:**
  - Activation maps the customers and suppliers that exist at that moment to the receivables (1100) and payables (2000) accounts. Anyone added later had no mapping, so an invoice or bill for them was refused ("Reviewed customer receivable mapping required").
  - `accounting.map_party` now maps such a party to that same account the first time it is used. It checks that:
    - the business is the one in scope, and its books are live
    - the caller is an active Owner, Admin or Editor
    - the party belongs to the business
    - the business has exactly one receivables or payables account
  - Only the runtime can call it.
  - Invoices and bills both use it.
- **Bills** (`cacu/accounting/bills.py`, `/accounting/bills`):
  - Owners, Admins and Editors record a supplier's bill: the supplier, their bill number, the dates, and one or more lines on expense accounts.
  - It posts the expense accounts (debit) against payables (credit). Cost of goods sold and stock write-offs are refused, as for expenses.
  - The same bill number from the same supplier can't be entered twice, ignoring case and spaces. The database enforces this too.
  - A retry replays the original result.
- **Payments:**
  - A payment goes against one bill, from cash or a chosen bank account, and may be part of what is owed but never more.
  - It can't be dated before the bill or in the future.
  - Opening bills are paid the same way.
- **List:** each bill shows the supplier, number, date, due date, total, what is still owed and its status, plus the total owed across all bills.
- **API:** `GET /supplier-bills`, `POST /supplier-bills` and `POST /supplier-bills/{id}/payments`.

## For the reviewer

1. Bills cover expenses only until goods receipts exist. Stock bought on credit can't be recorded yet.
2. One supplier can't have two bills with the same number. Suppliers that reuse numbers would need this relaxed.
3. Bills can't be voided or corrected yet. That needs a supplier credit note (R2).

## Verification

- `test_bills_postgres.py`, 13 cases on a business turned on from an approved opening position:
  - An opening bill is listed, paid in two parts with a replayed retry, refused when overpaid, and ends paid.
  - A supplier added after go-live is mapped on first use. Their bill posts both lines, and the duplicate number is refused. They are paid in cash, and the trial balance's payables check still agrees.
  - Invalid bills post nothing: an inventory or cost-of-sales account, a zero amount, a future date, a due date before the bill, a blank number, or an unknown or other business's supplier.
  - Viewers can't record bills or payments, an unknown bill is refused, and so is a payment dated before its bill.
  - A customer added after go-live can be invoiced.
  - `map_party` refuses another business's supplier and refuses viewers.
- Browser component test: recording a bill, the owed total, an overpayment caught on the page, and a retried unconfirmed payment that reuses the same key, at phone width.

## Release steps

Merge after the reports item. Apply the migration on staging first and run the checks there. Production is the same, after DEP-01 and DEP-02.
