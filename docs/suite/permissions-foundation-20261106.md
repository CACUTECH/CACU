# Permissions, part 1: the foundation (Doc 08, M-07)

This is the first of four steps that replace the four fixed roles (owner, admin, editor, viewer) with permission templates. This step changes nothing for anyone: every existing member is mapped to a template with exactly their current access, and no policy or function uses the new check yet.

## What is added

Migration `20261106100000_authz_foundation.sql`, in a private `authz` schema that only the decision function reads:

- **Permission catalogue:** 77 permissions, `module.action`, across 11 modules (sales, invoices, customers, inventory, services, expenses, ledger, banking, hr, settings, billing) and 7 actions (view, create, edit, approve, post, export, delete).
- **12 built-in templates:**
  - the 10 from Doc 08 §5: Owner, Admin, Accountant, Bookkeeper, Sales manager, Cashier, Inventory manager, HR manager, Service staff, Auditor;
  - Editor (legacy) and Viewer (legacy), covering what the editor and viewer roles can do today, including voiding invoices for editors. The old role checks still apply alongside the new one until templates are assigned on screen, so editors and viewers stay exactly where they are; part 4 tightens Editor (legacy) to today's exact rights.
- **Membership mapping:** `memberships.role_template_id` is backfilled from the role (owner → Owner, admin → Admin, editor → Editor (legacy), viewer → Viewer (legacy)). A trigger keeps it in step with the role until the screens assign templates directly (part 4).
- **Overrides:** `authz.membership_overrides` grants or revokes one permission for one person; a revoke wins.
- **`authz.has_permission(business, permission, outlet)`:** the one decision. It is true only when:
  - the caller has an active membership in the business;
  - the template plus grants, minus revokes, includes the permission (Owners hold everything);
  - the outlet, if given, is within the member's scope;
  - the plan includes the module (HR needs a plan with staff records; unbilled businesses keep everything).

  An unknown permission name raises an error instead of quietly answering no. Signed-in users and the runtime role can call it; nobody can read or write the tables.

## Decided for the next parts

- **Cashier discount cap:** 5% by default; the owner can change it (Doc 10, decided 6 November 2026).
- **Separation of duties** is on by default for Oga and Chairman, and can be switched off on General (Doc 08).
- **Plan changes become Owner-only:** Doc 08 says only the Owner changes the plan, but checkout and scheduling currently allow Admins as well. This is corrected when billing switches to the new check.
- **HR approvals:** the Admin template has no approve or post on HR (Doc 08), but payroll approval currently allows Admins. Decide when HR switches: follow Doc 08, or give Admin `hr.approve`.
- **"Own records" and "own outlet":** the Doc 08 table limits some templates to their own records or outlet. Outlet scope is in the decision function; "own records" is applied in each module as it switches.

## Part 2: sales, invoices, expenses, catalogue and staff (M-08)

Migration `20261106110000_permissions_sales_invoices_expenses.sql`. During the switch both checks must pass: the old role check and the permission. Every member is still on the template matching their role, so nobody's access changes.

- **Database functions:** `authz.require` raises `PERMISSION_DENIED <permission>` (42501). The migration patches each function from its live definition, adding one check after its opening `BEGIN`. It stops if a function doesn't have the expected shape, and running it again changes nothing.

  | Function | Permission |
  |---|---|
  | `process_sale_safe` | `sales.post` |
  | `create_invoice_safe` | `invoices.post` for an invoice, `invoices.create` for an estimate |
  | `record_payment_atomic` | `invoices.post` |
  | `update_invoice_status_safe` | `invoices.delete` to void, otherwise `invoices.post` |
  | `record_ledger_entry_safe` | `expenses.post` for an expense, `ledger.post` for income |
  | `management_write` | new item `inventory.create`; item or category edit `inventory.edit`; stock adjustment `inventory.post`; invitation `settings.create`; staff, outlets and teams `settings.edit` |

- **Row security:** the insert, update and delete policies on customers, suppliers (`inventory`), catalogue items, invoices, sales (`transactions`), appointments and jobs (`services`) become the existing rule AND `authz.has_permission(business_id, '<module>.<create|edit|delete>')`. The native `accounting_*` policies are unchanged; the Python core checks those writes.
- **Python core:** `library_transaction(..., permission=…)` checks the permission in the same transaction, after membership:
  - sales `sales.post`;
  - invoices `invoices.post` to issue, otherwise `invoices.create`;
  - receipts `invoices.post`;
  - expenses, bills and bill payments `expenses.post`;
  - journals and reversals `ledger.post`;
  - catalogue `inventory.create` or `inventory.edit`;
  - stock adjustment requests `inventory.create`;
  - generic postings by kind, with transfers `banking.post`.

  A refusal is a 403: "You do not have permission to do this in this business. Ask the business owner."
- **Screens:** the services show that same sentence for `PERMISSION_DENIED` (`src/lib/permission.ts`).
- **Tests:**
  - `test_permissions_switch_postgres.py` (5 cases): each function switched once and the migration safe to rerun; editors keep exactly what they had; a Cashier template sells and invoices but can't record expenses, void or change the catalogue; overrides reach the functions while owners are unaffected; the native API asks for each action's permission.
  - A policy case in `test_authz_postgres.py`: the old rule and the permission both apply.

## Next parts

1. Switch inventory and approvals, ledger and reports, HR, settings and billing.
2. Screens: choose a template and outlet when inviting, see what each template allows, and custom profiles on Oga and Chairman.

## Tests

`backend/tests/test_authz_postgres.py` (20 cases) restates the Doc 08 table, so a typo in the seed fails the build. It covers:
- each template's exact permissions;
- existing members keeping their access, and new or changed roles following the role;
- owners holding everything, and a cashier only the till;
- nothing for outsiders, inactive or signed-out users;
- unknown permissions raising an error;
- overrides, where a revoke wins;
- outlet scope;
- HR gated by plan;
- grants: callable, but no table access.
