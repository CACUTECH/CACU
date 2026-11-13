# Closing a business (Doc 10 E22 part 3, FR-210)

**Where it comes from in the specification:**
- **Doc 07:** retention classes and DB-004. Tenant data is removed only by the closure workflow.
- **Doc 08 GAP-10:** no owner-triggered cascade deletes.
- **Doc 14 SUB-11:** a cancelled business later goes through FR-210.
- **Doc 16:** data subject rights. Erasure stops where financial records must be kept.

**Owner decision of 9 November 2026:** 90 days to export before personal data is removed.

## What happens

**Settings › Close business** (`/settings/close`, Owner only). The Owner gives a reason and types the business name. At once:

- **Read-only:** every write gate that asks `platform.writes_allowed` refuses a closed business. That covers the table triggers, the legacy functions, the accounting API and the Data API. The API says "This business is closed", not "unpaid".
- **Staff:** they lose access. Their memberships are switched off and remembered. The Owner keeps read-only access.
- **Pay links:** revoked. Payments already received stay.
- **Billing:** if the business has a subscription, it is set to `closed` (renewals skip it), and open CACU invoices are voided.
- **A banner on every page:** "This business is closed, so everything is read-only", with links to export or reopen.

**For 90 days**, the Owner can export everything (exports work while read-only), or **reopen** the business. Reopening restores writes, the previous subscription status, and the staff who lost access. Plan seat limits still apply.

**After 90 days**, the **Closed businesses** job (daily, off until `CACU_CLOSURE_PURGE_ENABLED` is `true`) removes:
- **Personal details (R-PER):** customer and supplier email, phone, address, notes and company. Names stay, because they appear on the invoices and bills.
- **Operational data (R-OPS) and secrets:**
  - Customer and billing message logs, and notifications.
  - Receipt links, parked carts and invitations.
  - AI usage records.
  - The sealed Paystack key, and export files.

**What stays:**
- Financial and employment records (R-FIN and R-EMP: the books, invoices, sales, payments, payroll and staff records) stay read-only until `retain_until`, the end of the closing year plus six years. The Owner can still read them.
- Deleting them then is a later, separately recorded job; nothing does it yet.
- The business can no longer be reopened.

**The record:** every close, reopen and removal is kept in `platform.business_closure_events`, with the counts removed.

## Database

Migration `20261118090000_business_closure.sql`:
- **`platform.business_closure`:** one row per business, with its status (closed, reopened or purged), the 90-day date, `retain_until`, the staff removed and the previous subscription status. Plus `platform.business_closure_events`. Neither is reachable from the browser.
- **`platform.writes_allowed`:** also false for a closed or purged business.
- **`platform.read_only_guard`:** says `BUSINESS_CLOSED`, and lets only the removal job's own transaction clear contact details.
- **New functions:**
  - For the browser: `public.business_closure_status`, `public.close_business` and `public.reopen_business`.
  - Runtime only: `platform.purge_closed_businesses`, `platform.closures_due` and `platform.is_closed`.
- **Column-aware:** the removal clears only the contact columns a table has.

## Setup (not done by this change)

1. **Apply the migration** (`supabase db push`), after the two-step sign-in and data export migrations.
2. **Turn on the job:** set `CACU_CLOSURE_PURGE_ENABLED=true`. A manual run is a dry run that reports how many closures are due.

## Tests

- **`test_business_closure_postgres.py` (3):**
  - Only the Owner closes: the name must be typed (loosely), with a reason.
  - Read-only at once: `BUSINESS_CLOSED`, and the subscription closed.
  - Staff are out and see nothing; the Owner stays; it cannot be closed twice.
  - Reopening brings the staff and the subscription back; it can be closed again.
  - Not removed before 90 days, and no reopening after.
  - The removal clears contact details but keeps names and the ledger, deletes parked carts, records the counts, and stays read-only for good.
  - Browsers cannot run it.
- **Jest `business-closure-ui` (4):** refusal messages; closing only after typing the name and a reason, then reopening; the banner on every page; only the Owner sees the form.
