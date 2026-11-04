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

- **Downgrade choices:** before a downgrade applies, Doc 14 has the owner choose which users and outlets stay active. Today nothing is deactivated; the owner just can't add more while over the limit.
- **Message counter:** `messages.per_month` waits until CACU sends email or WhatsApp messages; nothing sends any yet.

## Scheduled jobs (M-10 part 1)

Migration `20261102120000_ops_scheduled_jobs.sql` adds two `pg_cron` jobs on hosted Supabase:
- **Trial end:** `ops.run_job('billing.end_trials')` runs every hour at :07.
- **Suspension:** `ops.run_job('billing.suspend_unpaid')` runs daily at 23:00 UTC, which is midnight in Lagos. A business is never suspended mid-trading-day (RSK-039).

Each run writes a row to `ops.job_runs` with the number of subscriptions it changed. A failure is logged with its error and changes nothing. Users and the runtime role can't run the jobs or read the log. Plain PostgreSQL (CI) has no `pg_cron`, so it gets the functions without the schedule.

After the migration is applied in production, check that both jobs are listed in `cron.job` (`cacu-billing-end-trials` and `cacu-billing-suspend-unpaid`).

## Plan limits (TEST-209)

The users and outlets limits below were confirmed by the owner on 4 November 2026 (migration `20261104130000_plan_limit_values.sql`, logged in `platform.config_changes`).

Migration `20261102130000_plan_limits.sql` enforces three limits with triggers on the tables themselves. The browser, the accounting API and direct Data API writes all meet the same check.

| Limit | General | Oga | Chairman | What counts |
|---|---|---|---|---|
| Users | 2 | 5 | 50 | Active members plus invitations still open. An expired invitation frees its seat until it is resent. |
| Outlets | 1 | 5 | 20 | Active outlets. |
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

## AI questions a month (TEST-210)

Migration `20261104090000_ai_plan_quota.sql`.

- **Monthly allowance:** asking a question now also checks the plan's monthly allowance: General 30, Oga 100, Chairman unlimited (owner-confirmed 4 November 2026), counted per Lagos calendar month. The existing shared rate limits still apply.
- **At the limit:** the question is refused before anything is recorded, so the counter doesn't move. The assistant says, for example, "You've used all 100 AI questions on your plan this month (0 left). They reset on 1 Dec 2026."
- **Failed answers:** a question whose answer failed doesn't count.
- **No AI on the plan:** if a plan's allowance were 0, the chat wouldn't be offered; today every plan includes AI. Chairman's unlimited allowance shows no counter.
- **Suspended business:** asks no questions until it pays (SUB-10).
- **Unbilled business:** keeps only the shared limits.
- **Seeing the allowance:** members see "37 of 100 AI questions left this month" in the assistant (`public.get_ai_chat_quota`). The billing usage panel shows AI questions next to users, outlets and catalogue items.
- **Tests:** 4 cases in `test_ai_chat_postgres.py`, plus Jest service and wording tests.

## Monthly and yearly switches (SUB-07) and quotes (SUB-R05)

Migration `20261104100000_interval_changes.sql`.

- **Monthly to yearly** is paid now, for the same plan or a bigger one. The charge is the yearly price less the unused value of the current month, rounded to the nearest naira, plus VAT. For example, Oga monthly with 20 of 30 days left switches to Oga yearly for ₦56,000 + ₦4,200 VAT, after a ₦4,000 credit. The year starts when the payment is verified.
- **Yearly to monthly** is scheduled for the end of the year (`scheduled_interval`), alone or with a smaller plan. A smaller plan without a yearly price, such as General, renews monthly. The renewal invoice, card charges and period end all use the scheduled plan and interval. Choosing the current plan and interval cancels it.
- **A bigger plan monthly from a yearly plan** waits for the year to end.
- **Quotes:** every change paid mid-period is quoted first by `public.billing_quote` (Owners and Admins). It uses the same calculation as checkout, `platform.change_charge`. The screen shows, for example, "Pay ₦60,200 now: ₦56,000 + ₦4,200 VAT, after ₦4,000 for your unused days" before anything goes to Paystack.
- **Tests:** 4 database cases in `test_platform_billing_postgres.py`; screen and action tests in Jest.

## Billing banner and real plan in the app (SUB-09)

- `SubscriptionProvider` now reads the active business's plan from `public.business_plan` (`getCurrentPlanAction`). It refreshes when the business changes and when the user leaves the billing page. A tier stored in the browser grants nothing, and a read-only (suspended) business has no paid tier. `FeatureGate` uses this tier. The database still enforces every limit itself.
- `BillingBanner` shows above every page except Billing:
  - a trial reminder in the last 4 days of the trial;
  - "Payment due. Pay by <date>" during grace;
  - the read-only notice once suspended;
  - a declined renewal card.
- **Who can pay:** Owners and Admins pay the open renewal in one tap, straight to Paystack, or are sent to Billing to choose a plan. Other members are told to ask the owner.
- **Not included:** email and WhatsApp reminders, which need a sending provider.
- **Tests:** Jest provider, banner and wording tests.

## PDF invoices and receipts (SUB-14)

- **Downloads:** Owners and Admins download any CACU invoice, and the receipt of any paid one, from Invoices and receipts on the billing screen.
- **Contents:** the seller is **CACU Technologies Limited, 15 College Road, Ipaja, Lagos State, Nigeria**, approved by the owner on 4 November 2026. No TIN is printed, on the owner's instruction. The buyer is the business name. Each document shows:
  - the invoice or receipt number and its dates;
  - what was bought and for which period, for example "Oga Plan, monthly subscription: 2 November 2026 to 2 December 2026";
  - the subtotal, VAT at its rate, and the total;
  - on a receipt, how it was paid.
- **How it works:** the PDF is drawn in the browser (`src/lib/billing-pdf.ts`, using the existing `jspdf`) from `public.business_billing_history`, which now also returns the VAT rate, the period and the payment channel (migration `20261104110000_billing_history_details.sql`). Amounts print as NGN because the PDF's built-in fonts have no naira sign.
- **Tests:** Jest document and screen tests; the history fields are checked in `test_platform_billing_postgres.py`.

## Billing reminders by email and SMS (SUB-04, SUB-08 to SUB-10)

Migration `20261104120000_billing_notifications.sql`, `backend/cacu/billing/notify.py`, the operator `backend/tools/send_notifications.py` and the workflow `.github/workflows/billing-notifications.yml`. Providers, chosen by the owner on 4 November 2026: **Resend** for email and **Termii** for SMS or WhatsApp.

- **What is queued:** `platform.queue_notifications()` runs hourly at :47 (`cacu-billing-queue-notifications`). It adds each reminder once per channel to `platform.notifications`:
  - the trial ending, 4 days and 1 day before;
  - a renewal invoice issued, saying whether the saved card will be charged;
  - each declined card charge;
  - payment due during grace;
  - read-only after suspension.
- **Who receives them:** emails go to the business's active owners. SMS goes to the business phone from setup, normalised to `234…`; a number that can't be read is skipped.
- **Sending:** the operator claims a batch and sends it. A failure retries after an hour, up to three attempts. A reminder more than three days old is dropped rather than sent late. A channel without its keys stays queued. Emails use an idempotency key, so a retry is not delivered twice. SMS shows amounts as NGN, because the naira sign makes a costlier unicode SMS.
- **Turning it on:** the workflow runs hourly at :52 and is off until `CACU_BILLING_NOTIFICATIONS_ENABLED` is `true`. It needs these in the `billing-operations` environment:
  - secrets: `CACU_DATABASE_URL`, `RESEND_API_KEY`, `TERMII_API_KEY`;
  - variables: `CACU_EMAIL_FROM` (on a domain verified in Resend), `TERMII_SENDER_ID` (approved by Termii), `CACU_APP_URL`, and optionally `TERMII_CHANNEL` (`generic`, `dnd` or `whatsapp`) and `TERMII_BASE_URL`.
- **Privacy:** reports print counts only. No addresses, numbers or message text are logged.
- **Tests:** 6 cases in `test_platform_billing_postgres.py`, with Resend and Termii replaced by stand-ins.

After applying in production, check that `cron.job` also lists `cacu-billing-queue-notifications`.

## Suspension is read-only (SUB-10)

Migration `20261105090000_suspension_write_gate.sql` and `backend/cacu/accounting/session.py`.

- **What a read-only business can't do:** while its subscription is suspended, cancelled or closed, a business can't add sales, invoices, expenses, stock movements, appointments or jobs. It also can't add or change customers, suppliers, catalogue items, categories or outlets, and it can't invite staff, bring staff back, or add employees.
- **What still works:** viewing and exporting everything, recording payments received against existing invoices (legacy and native), and removing staff. Grace and payment-due states keep full access.
- **Database layer:** triggers on the tables refuse new rows with `SUBSCRIPTION_READ_ONLY`. This covers the legacy functions, management actions, direct Data API writes and the native core alike. Tables that predate the tracked migrations get the trigger only where they exist.
- **Native core:** `library_transaction` refuses native writes before posting, except receipts (the `/receipts` route and postings of kind `receipt`).
- **Unaffected:** businesses with no subscription.
- **On screen:** every service shows the same message: "Your workspace is read-only until the subscription is paid. You can still record payments received and export."
- **Tests:** `backend/tests/test_suspension_gate_postgres.py`, on the shared library database with the real native ledger.

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
