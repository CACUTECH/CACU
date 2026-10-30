# R1 Start your books (opening position) - implementation review

## Scope

Doc 03 FR-012, Doc 09 PR-01, ACC-016 and section 8 steps 4 and 6, Doc 12 SCR-03 and UJ-03, DEC-004. Third Phase 2 item, built on the default chart. It captures and approves the opening position. Posting it to the ledger is the activation step (section 8 step 7, RB-05), which needs the runtime login (DEP-01) and the reviewed chart (DEP-02), and is the next item.

## Change

- Migration [20261031110000_opening_position.sql](../../supabase/migrations/20261031110000_opening_position.sql):
  - **`save_opening_position`** (Owner or Admin). It takes the answers: the start date, cash, each bank account in the chart, what each customer owes, what the business owes each supplier, loans, and money the owner put in. On the server it:
    - values stock from the catalogue as quantity × cost price of active tracked products, ignoring negative stock, so opening inventory equals the item records (ACC-013)
    - builds the summary and a balanced opening journal (PR-01): the asset accounts are debited; liabilities, capital (3000) and the remainder in retained earnings (3200) are credited, or 3200 is debited when the business owes more than it owns. Opening balance equity (3900) is not used, so it stays at zero, as Doc 09 section 4 requires
    - stores customer and supplier balances as separate lines for the per-party sub-ledgers.
  - **Retries and versions.** A retry with the same key replays the first result; a reused key with changed answers is refused. Saves name the version being edited, so two admins cannot overwrite each other (`VERSION_CONFLICT`).
  - **`approve_opening_position`** (Owner or Admin) approves exactly the version reviewed, recording approver, time and an optional note (ACC-016). An approved version cannot be changed or deleted (trigger). Editing afterwards creates a new draft and marks the approved one superseded, keeping it as history.
  - **Refusals.** Both save and approve are refused without an adopted chart, or once books are active.
  - **Audit.** Every save and approval writes an audit row.
  - **`opening_position`** (Owner or Admin) returns what the screen needs: chart readiness, bank accounts, customers, suppliers, live stock value, and the current version with its plain summary and journal.
- `/setup/books` asks one question per screen with a progress bar: cash and start date, banks, stock (read-only, with a link to Catalogue), customers who owe you, suppliers you owe, loans, money you put in. The review screen shows "What your business owns and owes" in plain words, with an accountant view of the journal, and an Approve button for Owners and Admins. The retry key is kept until a save is confirmed. A "Start your books" link is added under Accounting.

## For the reviewer (DEP-02)

1. The owner's "money you put in" is credited to capital and the rest to retained earnings, instead of everything going to opening balance equity and being transferred later.
2. Stock is the catalogue value at the stored cost price; weighted-average cost comes with FR-086.
3. Customer and supplier balances are single opening amounts per party, not open invoices or bills; receipts against them need the activation step to create opening documents.

## Verification

- `test_opening_position_postgres.py` (16 cases). It covers:
  - the server stock value excludes untracked, archived, negative and service items
  - the journal balances and equals what the business owns, with per-customer and per-supplier lines and no 3900
  - losses debit retained earnings
  - retry replay, reused-key refusal and version conflicts
  - approval freezes the version; updates and deletes are refused; a later edit supersedes it with history and audit
  - invalid amounts, dates, banks, customers and duplicates are refused with nothing saved
  - Editors, Viewers and other businesses are refused
  - a chart is required, and active books are refused
- Full backend 314 passed, 16 skipped. Jest 287 passed in 37 suites. Browser components 40 passed (adds the whole flow at 360 px with a retried save, the accountant view and approval). TypeScript, ESLint on changed files and `next build` passed.

## Release steps

Apply after `20261031100000`. Saving and approving change nothing in the ledger. Re-run the Supabase security advisor afterwards: the three new callable functions are each authorised through `management_private.authorize`. The reviewed list in `backend/tests/test_definer_access_postgres.py` and `docs/suite/definer-function-inventory-20261030.md` now includes `adopt_default_chart`, `chart_of_accounts`, `save_opening_position`, `approve_opening_position` and `opening_position`.
