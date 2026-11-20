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
- **HR approvals:** settled in part 3. The Doc 08 Admin row includes `hr.approve` (V C E A X), so admins keep payroll approval; payroll is approved with `hr.approve`.
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

## Part 3: inventory approvals, ledger and reports, HR, settings and billing (M-08)

Migration `20261106120000_permissions_ledger_hr_settings_billing.sql`. Both checks still apply.

- **Admin (legacy):** existing admins move to a new compatibility template, the Doc 08 Admin row plus `ledger.create`, `ledger.edit`, `ledger.approve`, `ledger.post` and `billing.post`. They keep reversals, period close, chart and opening balances, and paying a due renewal. The Doc 08 Admin template (ledger view and export only) is for people assigned it on screen.
- **Plan changes are Owner-only** (decided earlier, Doc 08 §5). Choosing or changing the plan, cancelling, saving downgrade choices and removing the saved card need `billing.edit`, which only the Owner holds. Admins still see billing and invoices and can pay a due renewal. The billing screen shows plan buttons and "Remove card" to the owner only.
- **Actor-aware check:** `authz.has_permission_for(actor, …)` and `authz.require_for` serve the billing functions that run on the runtime connection with the actor as an argument. `has_permission` now calls it with the signed-in user. Neither is granted to anyone.
- **Database functions** (patched from their live definitions, as in part 2):

  | Function | Permission |
  |---|---|
  | `hr_write` | new employee, attendance, payroll run `hr.create`; payroll approve or cancel `hr.approve`; other changes `hr.edit` |
  | `hr_history` | `hr.view` |
  | `management_read` | catalogue and options `inventory.view`; staff, outlets, teams, sign-ins, usage `settings.view` |
  | `adopt_default_chart`, `save_account` | `ledger.edit` |
  | `save_opening_position` / `approve_opening_position` / `opening_position` | `ledger.create` / `ledger.approve` / `ledger.view` |
  | `get_business_kpis`, `get_revenue_trend` | `sales.view` |
  | `legacy_invoice_balances` | `invoices.view` |
  | `billing_quote`, `business_billing_history`, `downgrade_choices` | `billing.view` |
  | `save_downgrade_choices`, `remove_payment_method`, `cancel_subscription`, `platform.open_checkout`, `platform.schedule_plan_change` | `billing.edit` |
  | `platform.renewal_checkout` | `billing.post` |

- **HR rows** read through the Data API (employees, attendance, payroll rules, runs and payslips) also need `hr.view`, so a plan without staff records shows none.
- **Python core:**
  - reports, journals and period close: `ledger.view`; submitting a close `ledger.create`, approving it `ledger.approve`; chart accounts and cash-flow classification `ledger.edit`;
  - expenses, expense accounts and supplier bills lists `expenses.view`; invoice balances `invoices.view`;
  - stock adjustment list, approval policy and valuation `inventory.view`; approving a stock adjustment, valuation policy, adoption and NRV `inventory.approve`; goods receipts and returns `inventory.post`; approval rules `settings.edit`;
  - a requester may still withdraw their own stock adjustment; posting within the limit without approval also needs `inventory.approve`.
- **Tests:** `test_permissions_part3_postgres.py` (5 cases) and `test_permissions_billing_postgres.py` (2 cases).

## Part 4: templates on screen (M-07)

Migration `20261106130000_permission_templates_on_screen.sql` and the Team screen (`src/components/access-templates.tsx`).

- **Inviting:** the invite form asks "What they can do" and shows, area by area, what the chosen template allows. `invite_member` creates the same invitation as before and remembers the template; accepting it gives the new member that template.
- **Changing someone's access:** an "Access" button on each member (not the owner, not yourself) calls `assign_role_template`.
- **Access templates tab:** every template with what it allows and how many people hold it. Legacy templates appear only while someone holds them.
- **Custom profiles** on Oga and Chairman (`module.custom_roles`): create, edit or delete (only when nobody holds it and no open invitation uses it). Editing a profile changes the access of everyone on it at once. Billing changes cannot be included.
- **No escalation:** anyone but the Owner can only hand out, or build a profile from, permissions they hold themselves.
- **Role envelope:** while the old role checks still run, each assignment also sets the role that covers the template. View-only templates are viewers; templates that approve, delete, manage staff, settings or HR, or change the chart are admins (and work across all outlets); the rest are editors. Legacy templates keep their own role. The remaining write policies that only checked the role (businesses, storefront settings, memberships, employees, attendance, payroll, accounts, ledger tables, invoice and sale lines) now also check the permission, so a wider role never opens more than the template allows.
- **A chosen template is kept** when other member details change. Changing the role on the Edit form still resets access to that role's standard template, and the form says so.
- **Tests:** `test_permission_templates_postgres.py` (5 cases), plus Jest for the descriptions, invite routing and messages.

### Not done in part 4, and why

- **Cashier 5% discount cap:** CACU has no discounts yet. Sales and invoices use catalogue prices, so there is nothing to cap. The cap (5% by default, owner can change) is built with POS discounts in R2.
- **Editor (legacy) tightening:** checked against today's editor at every switched function and policy. Editors update customers, suppliers, catalogue items, invoices and jobs through row security, post journals and submit period closes, so every permission in the template is in use. Nothing was removed.
- **Still role-only:** file uploads (logo), the chart-of-accounts list, collection accounts and AI chat. These are reads or owner/admin-only today; switch them when those modules are next touched.
- **Removing the old role checks** comes after templates have been used for a while. Until then both checks apply.

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
