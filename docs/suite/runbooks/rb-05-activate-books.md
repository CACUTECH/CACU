# RB-05 Turn on a business's books (pilot activation)

For the operator who activates a pilot business on the native ledger (Doc 09 §8, Doc 17 RB-05, Gate G2). What the tool does inside is in `docs/suite/turn-on-books-20261031.md`. Activation can't be undone; read the whole page before starting.

## Before you start

All of these must be true. Tick each one and keep the evidence with the release record.

- [ ] **Business chosen.** The owner has agreed in writing to join the pilot.
- [ ] **Chart reviewed (DEP-02).** The accountant reviewer has signed off the chart template, and production shows it as reviewed.
- [ ] **Opening position approved.** In CACU, under Settings > Start your books, an Owner or Admin has answered every question and approved, with the start date in the current year. If stock, customers or suppliers changed since then, the tool refuses and the owner approves again.
- [ ] **No old-style records after the start date.** No sales, sent invoices, payments or ledger entries dated after the start date. The tool checks this; choose a later start date if needed.
- [ ] **Backend ready (DEP-01).** The deployed Python backend uses the restricted `cacu_runtime` login with TLS, and the business's reports load in a browser.
- [ ] **Backup point.** Point-in-time recovery is on, or a fresh backup was taken in the last hour, and its time is noted.
- [ ] **Staging first.** The same steps ran on staging for a copy of a similar business.

You need two things:
- **The privileged database URL** (`CACU_MIGRATION_DATABASE_URL`). Keep it in your shell only; never paste it into chat, tickets or logs.
- **The user ID of the Owner or Admin who asked for activation**, from Settings > Users.

## Steps

1. **Dry run.** It checks everything, posts inside a transaction, prints the evidence, then rolls back. Nothing changes.

   ```
   cd backend
   python -m tools.activate_books <business_id> --operator <owner_user_id>
   ```

   If it prints `Not activated. …`, fix the reason (table below) and run the dry run again.

2. **Read the evidence with the owner.** Check the start date and the totals for cash, bank, stock, customers owed, suppliers owed, loans and capital. They must match what the owner approved. If anything looks wrong, stop: the owner corrects the opening position and approves again.

3. **Apply.** Only after the owner confirms.

   ```
   python -m tools.activate_books <business_id> --operator <owner_user_id> --apply
   ```

   It prints `Books are live from <date>`. Save the printed evidence with the release record. Never use `--staging-unreviewed` in production.

4. **Check the books straight away.** This is read-only.

   ```
   python -m tools.reconcile_books --apply --json --business <business_id>
   ```

   Expect `"status": "ok"` with `"clean": 1`. If you see `attention_required`, stop and follow "If a check fails" below.

5. **Check in the app** (signed in as the owner):
   - Settings > Start your books says "Your books are live from <date>".
   - The trial balance balances, with no exceptions at the top.
   - The balance sheet shows the approved cash, stock, customers owed and suppliers owed.
   - Invoices lists one opening invoice per customer who owed money (`OPEN-000001` and so on).

6. **First real transactions.** With the owner, record one real cash sale and one receipt against an opening invoice. Run step 4 again; it should still be clean.

7. **Turn on the daily check.** If the nightly reconciliation isn't enabled yet, set `CACU_BOOKS_RECONCILIATION_ENABLED` to `true`. Gate G2 needs two clean months of these checks for each pilot business.

## If the tool refuses

| Message | What to do |
|---|---|
| `OPENING_POSITION_NOT_APPROVED` | An Owner or Admin approves in Start your books |
| `STOCK_CHANGED`, `PARTY_REMOVED` | Something changed since approval; the owner reviews and approves again |
| `START_DATE_OUTSIDE_CURRENT_YEAR` | Choose a start date this year and approve again |
| `LEGACY_ACTIVITY_AFTER_START_DATE` | Choose a later start date so no records are left out |
| `CHART_NOT_READY`, `OPENING_ACCOUNT_UNMAPPED` | The chart isn't adopted or reviewed; adopt it in Settings, or wait for the reviewer |
| `OPERATOR_NOT_AUTHORISED` | Use the user ID of an active Owner or Admin |
| `BOOKS_ALREADY_SET_UP` | Already active; don't run again. Review the existing books instead |
| `PRIVILEGED_CONNECTION_REQUIRED` | Use the privileged migration URL, not the runtime one |

Every refusal leaves nothing behind.

## If a check fails after activation

Don't edit posted records. Open the trial balance and the named report (customers owed, suppliers owed, stock or cash) and find the document behind the difference. Correct it with a reversal or adjusting entry, which the accountant reviewer approves, then run step 4 again. If the trial balance itself doesn't balance, stop new postings for the business and treat it as a severity 1 defect (Doc 19 §7).

## Can't be undone

There's no "turn off". After activation the business writes only to the native ledger. Old-style records stay as read-only history. Mistakes are corrected with entries, never by resetting.
