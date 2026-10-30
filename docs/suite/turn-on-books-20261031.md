# R1 Turn on the books (activation) - implementation review

## Scope

Doc 09 section 8 step 7, FR-130, RB-05 and PR-01. Fourth Phase 2 item, built on Start your books. It posts an approved opening position to the ledger and switches the business to the accounting engine. It adds no migration. It is a privileged operator step, not a browser action: production use needs the restricted runtime login (DEP-01) and the accountant-reviewed chart (DEP-02).

## Change

- [backend/cacu/accounting/activation.py](../../backend/cacu/accounting/activation.py): `activate(connection, business_id, operator)` does all of this in one transaction, and any failure rolls everything back.
  - **Who and what.**
    - takes the tenant lock the runtime uses
    - requires a privileged connection
    - requires the requester to be an active Owner or Admin
    - requires the current opening position to be approved
  - **Checks that the approved version still matches the business:**
    - the stock value has not changed since approval (`STOCK_CHANGED`)
    - every customer and supplier in it still exists (`PARTY_REMOVED`)
    - the journal balances and equals what the business owns
    - the start date is in the current reporting year
  - **Old-style records.** Activation is refused when the business has records dated after the start date: ledger entries, journal entries, sent invoices, sales or successful payments. They would otherwise be left out of the new books (`LEGACY_ACTIVITY_AFTER_START_DATE`).
  - **Provisioning.** Sets up the adopted chart through the same rules as before. It refuses an unreviewed template unless staging is explicitly allowed.
  - **Posting.**
    - posts the approved journal as one compound journal entry dated on the start date, with per-customer and per-supplier line descriptions
    - proves the posted ledger, account by account, equals the approved journal
    - fires the deferred balanced-ledger checks before returning
  - **Turning on.**
    - writes `business_map` as active, with the start date as cutover and the reconciliation evidence: version, approver, operator, totals, template and whether it was reviewed
    - links the posting in `document_map` (`opening_balance`)
    - audits to `accounting.audit_event` and `public.audit_logs` (`BOOKS_ACTIVATED`)
- [backend/cacu/accounting/provisioning.py](../../backend/cacu/accounting/provisioning.py): the provisioning steps moved out of `tools/provision_entity.py` so that both tools share them. The staging tool behaves as before.
- [backend/tools/activate_books.py](../../backend/tools/activate_books.py) `<business_id> --operator <user_id> [--apply] [--staging-unreviewed]`. It is a dry run by default: it runs every check and the posting, prints the evidence, and rolls back. `--apply` commits.
- `/setup/books` shows "Your books are live from <date>" once active. Opening balances can't be edited after that.

## For the reviewer (DEP-02)

1. The opening journal is one compound entry. When several customers or suppliers share an account, their lines stay separate with the party name in the description, and the ledger balance is per account.
2. Customer and supplier opening balances are not yet opening invoices or bills. Until that follow-up, a receipt can't be allocated against an opening balance.
3. A cash-flow report whose period includes the start date shows the opening journal as cash flows. Reports should treat it as opening cash; this is left for the reports item.

## Verification

- `test_activation_postgres.py` (13 cases). It covers:
  - the ledger equals the approved journal by account
  - the business is active with the start date as cutover, the timezone, the document link and the audit row
  - the restricted runtime reads a balanced trial balance and balance sheet with the expected cash, stock, receivables and liabilities
  - opening answers are frozen and a second activation is refused
  - runtime postings dated before the start date are refused
  - refusals for an unapproved position, an unreviewed chart, Editors, Viewers and outsiders, changed stock, a removed customer, old-style records after the start date, and a start date outside the year; each refusal leaves nothing created
  - a dry run leaves nothing behind and the real run still works afterwards
  - choosing the main line when accounts repeat
- Browser components add the live state.

## Release steps

No migration. After merging, run on staging first:

`python tools/activate_books.py <business> --operator <owner> --staging-unreviewed`

Read the evidence, then re-run with `--apply`. In production, run without `--staging-unreviewed`, only after DEP-01 and DEP-02, and keep the printed evidence with the release record.
