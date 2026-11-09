# SECURITY DEFINER functions callable by signed-in users (Doc 08 GAP-07, SEC-011)

Source: Supabase security advisor and `pg_proc` on production (read-only, 29 October 2026). The advisor listed 21 such functions in `public`; trigger functions are not callable directly and are excluded. Every one has a fixed `search_path`.

| Function | Check | Decision |
| --- | --- | --- |
| `accept_business_invitation` | Invitation email must match the caller's verified email | Keep |
| `accounting_mode` | `is_business_member` | Keep |
| `adjust_inventory_stock` | Always raises; stock changes go through `management_write` | **Revoke** (20261030120000) |
| `can_read_upload` | Active membership and valid resource | Keep |
| `create_invoice_atomic` | Owner/Admin/Editor, but trusts client status, prices and totals | **Revoke** (20261030110000); replaced by `create_invoice_safe` |
| `get_business_kpis`, `get_revenue_trend` | `is_business_member` | Keep |
| `has_business_role`, `is_business_member` | Answer only for the caller | Keep |
| `hr_history`, `hr_write` | `management_private.authorize` (Owner/Admin) | Keep |
| `hr_payroll_defaults` | No tenant input; returns platform default rules | Keep |
| `legacy_invoice_balances` | Any active member | Keep |
| `management_read`, `management_write` | `management_private.authorize` per section or operation | Keep |
| `process_sale` | Forwards to `process_sale_safe` with a new request key each call, so a retry can post twice; unused | **Revoke** (20261030120000) |
| `process_sale_safe`, `record_payment_atomic` | Owner/Admin/Editor | Keep |
| `purchasing_allowed` (added 20261109090000) | Active membership of the business; returns only whether the plan includes purchasing | Keep |
| `share_receipt`, `revoke_receipt_link` (added 20261111090000) | `authz.has_permission` sales.view; only that business's sales and links | Keep |
| `public_receipt` (added 20261111090000) | Anyone holding an unguessable 64-hex link token sees that one receipt; no customer details; revocable | Keep (anon by design) |
| `send_invoice_reminder` (added 20261111100000) | `authz.has_permission` invoices.create; only that business's invoice, to its own customer | Keep |
| `notification_overview`, `save_notification_settings` (added 20261111090000) | Active membership (read, recipients masked); `settings.edit` and not read-only (save) | Keep |
| `record_audit` | Any member, including viewers, could write audit rows with any action and record id; unused since the ledger moved to `record_ledger_entry_safe` | **Revoke** (20261030120000) |
| `request_upload_delete` | Owner/Admin row, then `can_read_upload`, which requires an active membership | Keep |
| `reserve_upload` | Active membership with a role allowed for the purpose | Keep |

Added since the advisor run: `record_ledger_entry_safe`, `update_invoice_status_safe` (20261030100000) and `create_invoice_safe` (20261030110000), all Owner/Admin/Editor. Also `adopt_default_chart` (Owner/Admin) and `chart_of_accounts` (any member) from 20261031100000, and `save_opening_position`, `approve_opening_position` and `opening_position` (Owner/Admin) from 20261031110000, all through `management_private.authorize`.

Added with POS part 2 (20261107100000): `discount_caps` (needs `settings.view` through `authz.require`) and `save_discount_cap` (Owner only, through `management_private.authorize`).

Added with online payments (20261114090000), callable only by the accounting API's runtime role, never by signed-in users or anonymous visitors: `accounting.payment_link_target` (finds one business and invoice from an unguessable 64-hex pay-link token; live links of connected businesses only), `accounting.payment_webhook_target` (finds one business and its sealed Paystack key from the 64-hex token in its webhook address; the key stays AES-GCM ciphertext) and `accounting.payment_businesses` (the check job's list of connected businesses). Each also names who the API acts as, through `accounting.payments_actor` (not callable by any client role): the person who shared the link or connected Paystack while they may still record payments, otherwise the owner.

`backend/tests/test_definer_access_postgres.py` keeps this list honest: it fails when a callable SECURITY DEFINER function is not in its reviewed list or has no fixed `search_path`, and it calls every listed function as a member of another business and requires a refusal or an empty answer with nothing written. Re-run the advisor after each migration and update this table.

Added with two-step sign-in (20261116090000, E22 part 1):
- **Callable from the browser (`authenticated`), each answering only for the caller:**
  - `public.mfa_status`.
  - `public.new_recovery_codes`, only right after the second step.
  - `public.use_recovery_code`, five failed tries an hour. It deletes only the caller's own `auth.mfa_factors` rows.
- **Internal:** `authz.mfa_enrolled`, `authz.mfa_required` and `authz.session_level`, with no grants. `authz.mfa_ok` is granted to `authenticated` and `cacu_runtime`.
- **Changed:** `authz.has_permission`, `public.is_business_member`, `public.has_business_role` and `management_private.authorize` now also require `authz.mfa_ok`.

Added with the full data export (20261117090000, E22 part 2). All are callable only by the accounting API's runtime role:
- `accounting.exporting`: the export read policy. It is true only for the business and export in the API's own transaction, while that export is running and its requester is still an active member.
- `accounting.export_queue`: the job's list of waiting exports, stopped runs and expired files.
- `accounting.export_settle`: marks an export failed, or deletes a file past its seven days, and nothing else.
