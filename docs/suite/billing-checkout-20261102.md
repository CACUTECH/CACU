# Trials, Paystack checkout and verified activation (Phase 3, M-09 part 2)

This builds on `platform-plans-20261102.md` and applies the owner decisions of 2 November 2026:

- **Trial:** every new business starts a 14-day Oga trial. When it ends, the business moves to General with its first payment due.
- **Annual prices:** ₦60,000 for Oga and ₦150,000 for Chairman. General is monthly only.
- **VAT:** prices exclude VAT, and CACU is VAT-registered, so every CACU invoice adds 7.5% VAT.
- **Existing businesses:** none, so nothing is migrated.

## Amounts charged

| Plan | Monthly | VAT | Total | Annual total |
|---|---|---|---|---|
| General | ₦1,500 | ₦112.50 | ₦1,612.50 | — |
| Oga | ₦6,000 | ₦450 | ₦6,450 | ₦64,500 |
| Chairman | ₦15,000 | ₦1,125 | ₦16,125 | ₦161,250 |

The VAT rate, the trial and the grace period are stored in `platform.settings`, and changes to them are logged.

## Flow

1. **Setup:** setup starts the trial in the same transaction that creates the business. Hybrid can't be chosen at setup, because the trial plan has no Hybrid mode. The setup screen shows Hybrid as a Chairman Plan option, and the database refuses it too.
2. **Checkout:** `POST /api/v1/businesses/{id}/billing/checkout` takes `{request_key, plan, interval}`.
   - Only an active Owner or Admin can call it.
   - It creates a numbered CACU invoice (`CACU-INV-000001`), starts a Paystack checkout for the exact total, and returns the checkout link.
   - A retry with the same request key returns the same invoice and link.
3. **Activation:** the Paystack webhook (`POST /api/v1/webhooks/paystack`) and the owner's return from checkout (`POST …/billing/verify`) both lead to the same step.
   - The server asks Paystack's verify endpoint about the payment.
   - The database activates the plan only if the amount, the currency (NGN) and the reference match the invoice exactly.
   - That produces one receipt (`CACU-RCT-000001`), and a new period starts from the payment time.
4. **Webhook security:** webhooks are authenticated by an HMAC-SHA512 signature over the raw body, using `PAYSTACK_SECRET_KEY`.
   - Events are stored once per key.
   - A redelivery is processed again only if the first attempt didn't finish.
   - A short or wrong-currency payment flags the invoice for review and changes nothing else.
5. **End of trial:** `platform.end_trials()` moves expired trials to General, with the first payment due and 7 days of grace at full access. `platform.suspend_unpaid()` makes businesses that are unpaid after grace read-only. Paying restores full access.

## Not yet

- **Plan changes:** changing plans while active, with proration (SUB-05, SUB-06), and renewals with saved cards (SUB-04, SUB-08).
- **Entitlement checks:** seat, outlet and catalogue limits, and AI and message counters.
- **PDFs:** PDF invoices and receipts that show CACU's legal name, address and TIN.

## Scheduled jobs (M-10 part 1)

Migration `20261102120000_ops_scheduled_jobs.sql` adds two `pg_cron` jobs on hosted Supabase:
- **Trial end:** `ops.run_job('billing.end_trials')` runs every hour at :07.
- **Suspension:** `ops.run_job('billing.suspend_unpaid')` runs daily at 23:00 UTC, which is midnight in Lagos. A business is never suspended mid-trading-day (RSK-039).

Each run writes a row to `ops.job_runs` with the number of subscriptions it changed. A failure is logged with its error and changes nothing. Users and the runtime role can't run the jobs or read the log. Plain PostgreSQL (CI) has no `pg_cron`, so it gets the functions without the schedule.

After the migration is applied in production, check that both jobs are listed in `cron.job` (`cacu-billing-end-trials` and `cacu-billing-suspend-unpaid`).

## Billing screen

`/settings/billing` shows:
- the current plan, its status and what happens next, for example when the trial ends or the date to pay by;
- the three plans, monthly or yearly, with prices before VAT and the VAT note;
- each plan's main limits.

Owners and Admins choose a plan and go to Paystack. A retry of the same choice reuses its request key, so it never opens a second invoice. When the owner returns from Paystack, the page asks the server to verify the payment before it says anything is paid. Owners and Admins also see their CACU invoices and receipts. Editors and Viewers see the plans but can't choose one.

## Configuration

These go in the backend's environment, never with a `NEXT_PUBLIC_` prefix:

- `PAYSTACK_SECRET_KEY`: the secret key. Test keys start with `sk_test_`.
- `CACU_BILLING_CALLBACK_URL` (optional): the `https://` page Paystack returns the owner to.

## Tests

- `backend/tests/test_platform_billing_postgres.py` (16 cases):
  - the trial;
  - Hybrid refused at setup;
  - VAT on every plan and interval;
  - roles;
  - TEST-201 to TEST-204;
  - a failed first webhook attempt being retried;
  - trial end, grace, suspension and payment;
  - history visibility.
- `backend/tests/test_paystack.py`: signature and key handling.

The tests use a stand-in for Paystack. No live Paystack call has been made yet.
