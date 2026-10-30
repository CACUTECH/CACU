# R1 composite tenant keys (M-05) - implementation review

## Scope

Doc 07 M-05 and DB-003/DB-004, Doc 08 GAP-04 and SEC-002, Doc 19 TEST-002 (second part). This is the first Phase 2 item. It has no outside dependency; the remaining Phase 2 items wait on DEP-01 to DEP-03 and the Gate B transfer decision.

## Production findings (read-only, 29 October)

- 20 references between tenant tables used single-column foreign keys, so a row could point at another business's customer, invoice, sale, payment, item, account, journal or employee if an application check failed. Only the catalogue, locations, teams, stock movements and HR payroll already used composite keys.
- `business_id` was nullable on `attendance`, `payment_events` and `suppliers`, which would let a composite key be skipped.
- Deleting a customer blanked the customer on their invoices, sales and payments (PRIN-05). Invoice lines, sale lines, journal lines, payment history and attendance cascaded from their parents. Nothing can delete those parents today (no grants and no SECURITY DEFINER deleter), so changing those cascades does not change current behaviour.
- A cross-tenant reference check returned 0 for every relationship, and there are no null `business_id` rows in the three tables.

## Change

Migration [20261031090000_composite_tenant_keys.sql](../../supabase/migrations/20261031090000_composite_tenant_keys.sql):

- Checks every relationship first. If any row already references another business, it stops with `CROSS_TENANT_REFERENCES <table.column>: <count>` and changes nothing.
- Sets `business_id` NOT NULL on `attendance`, `payment_events` and `suppliers`.
- Adds `UNIQUE (id, business_id)` to each referenced table, then replaces each single-column key with `(column, business_id) REFERENCES parent (id, business_id)`.
- Delete behaviour:
  - Invoices, sales, payments, lines, journals, attendance and payslips now block deletion of what they reference instead of cascading or blanking it.
  - Appointments and jobs still clear a deleted customer, but keep their `business_id` (`ON DELETE SET NULL (customer_id)`).
  - Prototype payslips still cascade from prototype payroll runs, which are retired in M-18.
- Adds `(business_id, ...)` indexes for the new keys on invoices, sales, payments and line tables.

App: deleting a customer with invoices, sales or payments, or a supplier linked to catalogue items, now explains why it cannot be removed instead of showing a database error.

## Verification

- `test_composite_tenant_keys_postgres.py` (10 cases) runs against a copy of the 20 hosted keys and actions. It covers:
  - all keys composite and validated
  - cross-tenant inserts refused for invoices, sales, payments, appointments, attendance and invoice lines
  - a customer with an invoice cannot be deleted, while a customer with only a booking can
  - invoice lines no longer cascade
  - an existing cross-tenant row stops the migration with nothing changed
- Full backend 286 passed, 16 skipped. Jest 266 passed. Browser components 35 passed. TypeScript, ESLint on changed files and `next build` passed.

## Release steps

1. Apply after `20261030100000`, `20261030110000` and `20261030120000`, on staging first when it exists, then production as a person with a recorded backup point.
2. Immediately before applying, rerun the read-only cross-tenant check (the migration does it too, and stops safely).
3. After applying: no single-column key between tenant tables remains, and the security and performance advisors show no new warnings.

Rollback: dropping the composite keys would reopen GAP-04; correct forward instead.
