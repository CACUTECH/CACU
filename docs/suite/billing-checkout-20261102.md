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

- **Monthly to yearly mid-period** (SUB-07). Doc 14 prorates it; today it waits for renewal.
- **Owner notifications** for renewals and declined cards (email, WhatsApp). Today they show on the billing screen only.
- **Downgrade choices:** before a downgrade applies, Doc 14 has the owner choose which users and outlets stay active. Today nothing is deactivated; the owner just can't add more while over the limit.
- **Usage counters:** AI questions and messages a month (TEST-210).
- **PDFs:** PDF invoices and receipts that show CACU's legal name, address and TIN.

## Scheduled jobs (M-10 part 1)

Migration `20261102120000_ops_scheduled_jobs.sql` adds two `pg_cron` jobs on hosted Supabase:
- **Trial end:** `ops.run_job('billing.end_trials')` runs every hour at :07.
- **Suspension:** `ops.run_job('billing.suspend_unpaid')` runs daily at 23:00 UTC, which is midnight in Lagos. A business is never suspended mid-trading-day (RSK-039).

Each run writes a row to `ops.job_runs` with the number of subscriptions it changed. A failure is logged with its error and changes nothing. Users and the runtime role can't run the jobs or read the log. Plain PostgreSQL (CI) has no `pg_cron`, so it gets the functions without the schedule.

After the migration is applied in production, check that both jobs are listed in `cron.job` (`cacu-billing-end-trials` and `cacu-billing-suspend-unpaid`).

## Plan limits (TEST-209)

Migration `20261102130000_plan_limits.sql` enforces three limits with triggers on the tables themselves. The browser, the accounting API and direct Data API writes all meet the same check.

| Limit | General | Oga | Chairman | What counts |
|---|---|---|---|---|
| Users | 2 | 5 | 15 | Active members plus invitations still open. An expired invitation frees its seat until it is resent. |
| Outlets | 1 | 2 | 5 | Active outlets. |
| Catalogue items | 300 | 3,000 | Unlimited | Active items. Archiving an item makes room. |

- Only a new or reactivated row is refused, with `PLAN_LIMIT <key>`. Accepting an invitation fills the seat the invitation already held.
- After a downgrade, everything already there stays usable. Nothing is deactivated for the owner; they can't add more until they are under the new limit.
- A business with no subscription and a JSON-null limit are not limited.
- `public.business_plan` now returns `usage`, and the billing screen shows, for example, "2 of 2 users · plan limit reached".
- The users, outlets and catalogue screens show the refusal in plain words.
- Tests: 5 cases in `backend/tests/test_management_postgres.py`, run through the real `management_write`, invitation acceptance and the accounting catalogue path.

## Plan changes (SUB-05, SUB-06) and period end

Migration `20261102140000_plan_changes.sql`.

- **Upgrade:** an active business checks out a bigger plan on its current interval. The CACU invoice (kind `upgrade`) charges the new price minus the current price for the time left in the period, rounded to the nearest naira, plus VAT. For example, Oga to Chairman with 20 of 30 days left is ₦6,000 + ₦450 VAT. On payment the plan and its limits change at once and the period end stays the same. If the period changed before the payment arrived, the invoice is flagged for review and nothing changes.
- **Refused mid-period:** the same plan, a smaller plan through checkout, a switch between monthly and yearly, and an upgrade with under a day left ("renew first").
- **Downgrade:** `POST /api/v1/businesses/{id}/billing/schedule` with `{plan}` schedules a smaller plan for the period end, at no charge. Choosing the current plan cancels it. The response lists any limit the business is over on the new plan. A Hybrid business can't schedule a plan without Hybrid. If it switches to Hybrid after scheduling, it stays on Chairman.
- **Period end:** `platform.end_periods()` runs hourly at :17 (`cacu-billing-end-periods`). It applies a scheduled downgrade and moves the subscription to `past_due`, with the usual 7 days of grace. Then `suspend_unpaid` makes it read-only. The owner renews by choosing a plan at checkout, and can switch between monthly and yearly then.
- **Billing screen:** it shows "Upgrade to …" with the proration note, "Move to … on <date>" and "Keep my current plan". After a downgrade is scheduled it warns about anything over the new limits. Upgrade invoices are labelled in the history.
- **Tests:** 7 cases in `test_platform_billing_postgres.py`; screen and action tests in Jest.

After applying in production, check that `cron.job` also lists `cacu-billing-end-periods`.

## Renewals and saved cards (SUB-04, SUB-08)

Migration `20261102150000_renewals.sql`, the operator `backend/tools/renew_subscriptions.py` and the workflow `.github/workflows/billing-renewals.yml`.

- **Saved card:** a confirmed card payment marked reusable saves its authorization in `platform.payment_methods`. Only definer functions read it, never users or the runtime role directly. Owners and Admins see "Visa ending 4081, expires 12/2030" on the billing screen and can remove it.
- **Renewal invoice:** `platform.issue_renewals()` runs hourly at :27 (`cacu-billing-issue-renewals`). It issues a renewal invoice 3 days before an active period ends, on the plan the next period will have, including a scheduled downgrade. If an upgrade, a new or cancelled downgrade or a new period makes it stale, it is voided and reissued.
- **Card charge:** the operator charges the saved card from 6 hours before the period ends, then on days 1, 3 and 5 of grace if it is declined. Each attempt has its own `CACU-REN-…` reference and is logged in `platform.charge_attempts`. Only Paystack's verify endpoint activates anything. A renewal paid inside grace starts where the old period ended, so no days are lost; once suspended, it starts from the payment.
- **Pay by link:** with no card, or after a decline, the billing screen shows the amount due and "Pay ₦… now" (`POST /api/v1/businesses/{id}/billing/renewal`), using the same checkout and verify steps.
- **Late payments:** a payment for an invoice that was voided or no longer applies is flagged for review and changes nothing else. The owner's return from Paystack checks this too.
- **Workflow:** it runs hourly at :40 but stays off until the repository variable `CACU_BILLING_RENEWALS_ENABLED` is `true`. It needs the secrets `CACU_DATABASE_URL` and `PAYSTACK_SECRET_KEY` in the `billing-operations` environment. It prints counts only.
- **Tests:** 6 cases in `test_platform_billing_postgres.py`, with Paystack replaced by a stand-in; screen and action tests in Jest.

After applying in production, check that `cron.job` also lists `cacu-billing-issue-renewals`.

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
