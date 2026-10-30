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
| `record_audit` | Any member, including viewers, could write audit rows with any action and record id; unused since the ledger moved to `record_ledger_entry_safe` | **Revoke** (20261030120000) |
| `request_upload_delete` | Owner/Admin row, then `can_read_upload`, which requires an active membership | Keep |
| `reserve_upload` | Active membership with a role allowed for the purpose | Keep |

Added since the advisor run: `record_ledger_entry_safe`, `update_invoice_status_safe` (20261030100000) and `create_invoice_safe` (20261030110000), all Owner/Admin/Editor. Also `adopt_default_chart` (Owner/Admin) and `chart_of_accounts` (any member) from 20261031100000, and `save_opening_position`, `approve_opening_position` and `opening_position` (Owner/Admin) from 20261031110000, all through `management_private.authorize`.

`backend/tests/test_definer_access_postgres.py` keeps this list honest: it fails when a callable SECURITY DEFINER function is not in its reviewed list or has no fixed `search_path`, and it calls every listed function as a member of another business and requires a refusal or an empty answer with nothing written. Re-run the advisor after each migration and update this table.
