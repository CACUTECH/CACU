# Customer notifications (Doc 10 E20)

Owner decisions of 7 November 2026: emails are not limited; texts (SMS or WhatsApp through Termii) come from a monthly allowance by plan; overdue invoice reminders and booking messages are automatic once the business turns them on; receipt links keep working until revoked.

## What a business can send

| Message | When | Needs |
|---|---|---|
| **Receipt** | Staff press "Send to customer" on a till receipt and give an email, a phone number, or neither (just a link) | `sales.view` |
| **Invoice reminder** | Automatic: the day before an unpaid invoice is due, on the due date, and 7 days after, while something is owed. Or "Send reminder" on any unpaid invoice | Invoice reminders on (automatic); `invoices.create` (by hand) |
| **Booking confirmation** | When a booking is made for a later time | Booking messages on; Oga or Chairman plan (`module.booking_reminders`) |
| **Booking reminder** | About a day before, for bookings made more than a day ahead | As for the confirmation |

- **Text or email:** a message goes by text when the customer has a Nigerian mobile number and the month's texts are not used up, otherwise by email when there is an address. A receipt goes to whichever addresses staff give, and the screen says when no text was sent because the allowance is used.
- **Allowance** (`messages.texts_per_month`): General 20, Oga 200, Chairman 1,000 a Lagos calendar month. A business without a subscription gets the General allowance. Settings › Notifications shows the count.
- **Limits against misuse:** at most 5 messages of a kind per channel for one sale, invoice or booking, and 500 messages a day per business.
- **Quiet hours:** automatic reminders are queued between 9:00 and 20:00 Lagos time (hourly job `messages.queue_reminders`).
- **Wording:** texts start with the business's name; emails are from CACU's sending address with the business's email as reply-to, and say "Sent for {business} by CACU".

## Receipt links (`/r/{token}`)

- The token is 64 random hex characters. The page opens without an account and shows the business (name, address, phone), the receipt number, date, items, totals and how it was paid. Never the customer's phone or email.
- The link keeps working until staff revoke it on the receipt. Sending the receipt again makes a new link.

## Privacy

- A customer's address is kept in the outbox only to send the message; it is cleared 30 days after the message is finished. The history keeps a masked form (a***@example.com, 0803***4567).
- The operator's reports carry counts only, never addresses, numbers or message text.

## Sending

- `tools/send_customer_messages.py` claims and sends queued customer messages, as `tools/send_notifications.py` does for billing reminders. Both run in the **Billing notifications** workflow, now every 15 minutes, which stays off until the repository variable `CACU_BILLING_NOTIFICATIONS_ENABLED` is `true` and needs the Resend and Termii keys (`RESEND_API_KEY`, `CACU_EMAIL_FROM`, `TERMII_API_KEY`, `TERMII_SENDER_ID`) and `CACU_APP_URL` for links.
- A channel without keys stays queued; messages older than three days are dropped as stale rather than sent late.

## Database

- `20261111090000_customer_messages.sql`: the allowance entitlement; `public.notification_settings`, `public.receipt_links`, `platform.customer_messages`; `share_receipt`, `revoke_receipt_link`, `public_receipt` (anon, by token), `notification_overview`, `save_notification_settings`; the operator's `claim_customer_messages` and `finish_customer_message`.
- `20261111100000_customer_reminders.sql`: `send_invoice_reminder`; the booking confirmation trigger; `platform.queue_customer_reminders` and the hourly job (`ops.run_job` learns `messages.queue_reminders`; pg_cron at :12).
- Owed on an invoice: on the books, its total less the amounts assigned to clear it; otherwise its total less successful payments.

## Tests

- `test_customer_messages_postgres.py` (3): receipt by email, text and link, a retry, the public page without customer details, revoking, invalid addresses, outsiders refused; the operator sends both and clears addresses after 30 days; the allowance and email fallback; the settings page and who may change it.
- `test_customer_reminders_postgres.py` (3): reminders before, on and after the due date, once each, only when on and during the day, none once paid; a reminder by hand, viewers refused, email past the allowance, no contact; booking confirmation and day-before reminder.
- Jest `customer-messages-ui` (3): sending a receipt, the public receipt page, the notifications page.
