# Online invoice payments through the business's own Paystack account (Doc 10 E23)

Doc 18 puts E23 "payment provider integration" (FR-220 to FR-223) in R2. Doc 09 PR-14 and PR-15 set the accounting, Doc 11 the endpoints and the webhook rules, and Doc 14 TEST-201 to TEST-204 apply to tenant payments too (Doc 11).

**Owner decisions of 9 November 2026:**

- **Whose account:** customers pay into the business's own Paystack account. CACU never holds the money (ADR-008); Paystack subaccounts under CACU's account were rejected.
- **Settlements:** payouts are matched to the bank as part of this release (PR-15).

## Connecting Paystack (Settings › Online payments)

- **Who:** an Owner or Admin pastes the business's Paystack secret key and chooses the reviewed bank account Paystack pays into.
- **Checking the key:** CACU checks the key with Paystack before saving it. A wrong or revoked key is refused.
- **Storing the key:** it is sealed with AES-256-GCM under the server secret `CACU_PAYMENT_KEY_ENCRYPTION_KEY`, and bound to the business, so it cannot be opened for another business. The database holds only the ciphertext. Screens show only a hint such as `sk_live_...a1b2`, and the key is never logged.
- **Chart accounts:** connecting adds Card and online payments clearing (1030, the new account kind `gateway_clearing`) if it is missing. It also adds Customer deposits and advances (2100), so money paid beyond an invoice always has somewhere to go. The chart must have one Bank and payment charges account (6400, `gateway_fees`); the default chart does.
- **Webhook address:** connecting gives the business its own address, `/api/v1/webhooks/paystack/{token}`, shown only to Owners and Admins, to paste in Paystack (Settings, API Keys & Webhooks). Without it, payments are still confirmed when the customer comes back from Paystack and by the check job.
- **Disconnecting:** deletes the saved key, and pay links stop working. Payments already posted stay in the books.

## Pay links

- **Making a link:** "Share pay link" on an issued invoice (`invoices.post`) makes one link per invoice, `/pay/{64 hex}`. Staff can copy it, share it on WhatsApp, or withdraw it.
- **What the customer sees:** the page opens without an account. It shows the business (name, address, phone), the invoice number, the customer's name, the total and what is still owed. It never shows the customer's email or phone.
- **How much:** the customer chooses the amount, at least ₦100 unless it clears the invoice, and at most what is owed less transfers already waiting for confirmation.
- **Email:** Paystack needs one. The customer's email on file is used if there is one, without showing it; otherwise the customer types one.
- **Before Paystack:** the checkout is recorded first (`accounting.online_payment`, reference `CACU-PAY-…`), so every reference Paystack sees is one CACU knows.
- **Paying:** the customer pays on Paystack's own page by card, bank, USSD or bank transfer, and Paystack brings them back to the link.

## When a payment counts (BR-010, TEST-201 to TEST-204)

- **Paystack's verify call decides.** Nothing posts until Paystack's verify endpoint, called with the business's key, says `success` for that reference in naira.
- **News that triggers a check:** the customer coming back, a webhook, the check job, or "Check Paystack now". None of these is trusted on its own.
- **Webhooks:**
  - Each is checked against the business's own key (HMAC-SHA512) before anything is read. A bad signature gets 401 and is logged without details.
  - Each event is stored once in `accounting.payment_event`, keyed by event, so repeats are ignored.
  - Events for the business's other Paystack sales (not CACU references) are stored and left alone.
- **A verified payment** debits Card and online payments clearing and credits the customer's receivable, allocated to the invoice (PR-14, internal posting kind `gateway_receipt`). The invoice turns Paid when nothing is left. A matching `public.payments` row (channel `paystack`) is written, as manual receipts do.
- **More money than is owed:** for example, cash was taken while the customer was on Paystack. The invoice takes only what it still needs. The rest is kept as the customer's advance (PR-10; Dr clearing, Cr 2100), which can later be applied or handed back (E11).
- **Another currency, another reference, or an unreadable answer:** held as **Needs review**, never posted.
- **A checkout that never succeeds:** marked "Not completed" after 6 hours. If Paystack later confirms it after all, it is still posted.
- **The check job and "Check Paystack now"** re-verify checkouts still waiting from the last 7 days.

## Payouts (PR-15)

- **When:** the check job, every 30 minutes, and "Check Paystack now" (Owners and Admins) list Paystack settlements from the last 14 days. Each paid-out settlement is matched once (`accounting.gateway_settlement`, which is permanent).
- **Matching:** by Paystack's per-settlement transaction list (reference, amount, fees). Each CACU payment in it is marked settled.
- **Posting** (internal kind `gateway_settlement`):
  - Dr the payout bank with the net amount;
  - Dr Bank and payment charges with the fees;
  - Cr Card and online payments clearing with the gross.
- **Held for review:** money in a payout that did not come through a CACU pay link, or a Paystack total that differs from the match, is not posted. The settlement is marked **Needs review** with a note, and the CACU payments in it are still posted.
- **Settings page:** shows the payments, their fees, whether each has been paid out, what is waiting for payout, and each payout.

**Confirm in Paystack test mode before the first live business:** the settlement fields this relies on. Paystack's published API spec does not type the settlement object. CACU reads `id`, `status` (`success`), `settlement_date` and `total_amount` (net, kobo) from `GET /settlement`, and `reference`, `amount` and `fees` from `GET /settlement/{id}/transactions`. If `total_amount` turns out to mean something else, every payout will show as Needs review rather than post wrongly.

## Who the API acts as

A customer paying, a webhook and the job have no signed-in person. The API finds the business through the secret token, or the job's list. It then works inside that business's own row-level-security transaction as the person who shared the link (or connected Paystack), provided they are still an Owner, Admin or Editor; otherwise it acts as the owner.

The three definer lookups are callable only by the API's runtime role (see the definer function inventory).

Public pay calls do not use the sharer's per-minute write allowance (API-012), so a link cannot be used to lock the business out of its own writes. Instead each link allows at most 10 waiting checkouts an hour.

**Not yet:** there is no per-IP limit on the public pay endpoints. Add a Vercel firewall rule on `/api/v1/pay/*` before live traffic.

## Setup (not done by this change)

1. Set `CACU_PAYMENT_KEY_ENCRYPTION_KEY` (32 random bytes, base64) on the accounting API and in the `billing-operations` GitHub environment. Changing it later makes saved keys unreadable, and owners must connect again.
2. Set `CACU_APP_URL` (already used for message links) so Paystack returns customers to `/pay/{token}`.
3. Apply the migration (`supabase db push`).
4. Set the repository variable `CACU_ONLINE_PAYMENTS_ENABLED=true` to start the **Online payments** workflow, which runs every 30 minutes; a manual run is a dry run unless "apply" is ticked.

## Database

Migration `20261114090000_online_payments.sql`:

- **Account kind:** `gateway_clearing` (asset, current, codes 1030 to 1039).
- **New tables:**
  - `accounting.payment_provider`: one Paystack connection per business, holding only the sealed key.
  - `accounting.payment_link`: one live link per invoice; revocable.
  - `accounting.online_payment`: each checkout. It is decided once; its core fields never change; it is settled once.
  - `accounting.payment_event`: each webhook event, stored once.
  - `accounting.gateway_settlement`: each payout matched; permanent.
- **Security:** row-level security is forced on all five tables for `cacu_runtime`. The definer lookups are `payment_link_target`, `payment_webhook_target`, `payment_businesses` and `payments_actor`.

The posting engine gains the internal kinds `gateway_receipt` (PR-14) and `gateway_settlement` (PR-15). An advance (`customer_advance`) may now also arrive in Card and online payments clearing.

New backend dependency: `cryptography==50.0.2` (with `cffi` and `pycparser`), approved on 9 November 2026.

## API

| Method and path | Who |
|---|---|
| `GET /businesses/{id}/online-payments` | `invoices.view` (the webhook address only for Owners and Admins) |
| `PUT /businesses/{id}/online-payments/paystack` | Owner or Admin; the key is checked with Paystack first |
| `DELETE /businesses/{id}/online-payments/paystack` | Owner or Admin |
| `POST /businesses/{id}/online-payments/check` | Owner or Admin |
| `POST /businesses/{id}/invoices/{invoice}/payment-link`, `…/payment-link/revoke` | `invoices.post` |
| `GET /pay/{token}`, `POST /pay/{token}`, `POST /pay/{token}/verify` | Anyone holding the link (no user token) |
| `POST /webhooks/paystack/{token}` | Paystack, signed with the business's key |

CACU's own subscription webhook (`/webhooks/paystack`, CACU's key) is unchanged.

## Tests

- **`test_online_payments_postgres.py` (3):**
  - The sealed key is bound to its business.
  - Only Owners and Admins connect, and the key is never stored in plain text.
  - One link per invoice, with no customer contact details on the public page.
  - Amount and email checks.
  - TEST-201 (coming back proves nothing), TEST-202 (a forged webhook gets 401), TEST-203 (the same event three times posts once) and TEST-204 (a different currency is held for review).
  - Part payments, and an overpayment kept as advance.
  - The payout posting net to the bank and fees to 6400, and emptying clearing; recorded once.
  - A payout with outside money held for review; the job verifying a waiting checkout.
  - Settlement and payment records that cannot change.
  - The books balancing.
  - Withdrawing a link and disconnecting.
  - Strangers and other businesses see nothing, and the definer helpers are not callable by the runtime directly.
- **Jest `online-payments-ui` (7):**
  - The amount rule.
  - The pay page: what is owed, pay part, the email, Paystack refusing.
  - Coming back paid.
  - A withdrawn link showing nothing.
  - Connecting: key format, payout bank, webhook address, the key not kept on screen, payouts to review, Check now.
  - Only Owners and Admins see the form.
  - Sharing and withdrawing a link.
