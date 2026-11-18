# Bank reconciliation (Doc 10 E14 R3; Doc 03 FR-134)

**Where it comes from in the specification:**
- **Doc 03 FR-134:** bank reconciliation.
- **Doc 09:** month-end checklist step 2, "bank and cash accounts reconciled to statements or counts".
- **Doc 11 R3:** `POST /bank/statements` (CSV) and `POST /bank/matches`.
- **Doc 12:** replaces the "Bank Reconciliation, not available yet" page.

**Owner decisions of 18 November 2026:**
- **Statements:** any bank's CSV. The owner points out its date, description and amount (or money in and money out) columns once, and CACU remembers the layout for that bank account. There are no built-in bank layouts until real, anonymised sample statements are available.
- **Unmatched lines:** recorded from the reconciliation screen in one step. Money out becomes an expense (Bank and payment charges unless another expense account is chosen); money in becomes other income. It is posted and matched together. Anything else can be marked explained with a note.

## What happens

**Analytics › Bank Reconciliation** (`/analytics/reconciliation`):

1. **Choose a bank account and a month.** Only accounts that can take transfers are listed.
2. **Import a statement.**
   - The owner picks the CSV file.
   - CACU finds the table even when account details sit above it, as on most Nigerian statements, and guesses the columns from their names (Trans. Date, Narration, Debit, Credit, Balance and so on). Or it uses the layout remembered for that account.
   - The owner checks the header row, the columns and the date order (day-month-year by default).
   - Amounts can be written with commas, ₦ or NGN, brackets for negatives, or CR/DR.
   - Lines dated before the books started are left out. A file already imported is refused, and lines already imported from an overlapping statement are skipped. Two identical payments on the same day stay two lines.
   - Limits: 2 MB and 5,000 lines.
3. **Work through the lines.** Each unmatched line offers:
   - **Match:** entries in the books within seven days that moved this bank account by exactly the same amount.
   - **Confirm transfer and match** (money in): transfers still waiting for confirmation of the same amount, expected at this bank or any bank, from the 30 days before. The statement shows the money arrived, so CACU confirms the transfer into this account, then matches what that posted.
   - **Record as bank charge** (money out) or **Record as other income** (money in). This posts the entry on the line's date and matches it. It's refused if that month is closed.
   - **Explain,** with a note of at least 5 characters.
   - **Undo** on a matched or explained line puts it back. Any entry it posted stays.
4. **The summary** says how many lines are still to match, and how many entries in the books for the month aren't on the statement. It also shows the books' balance and the statement's closing balance.
   - **Reconciled** means every line and every entry is accounted for.
   - The opening-balance entry from the day the books started isn't counted, because it is where the statement starts.

**Month close:** the "bank and cash" step now says how many bank accounts are reconciled in CACU for the month. It stays a step the closer ticks, because cash is still counted by hand.

## How it is stored and enforced

- **Tables:**
  - `accounting.bank_layout`: one per bank account, the last layout used.
  - `accounting.bank_statement`: one per file imported, unique per account by the file's SHA-256.
  - `accounting.bank_line`: each line, with its amount (money in positive), the balance when given, its place in the statement, and a fingerprint (date, amount, description, and which occurrence on that day) that keeps overlapping statements from importing a line twice.
- **Matching rule:** a line matches one ledger entry. The entry's movement on that bank account (debits less credits) must equal the line's amount, and a unique index stops an entry being matched to two lines.
- **Permissions:**
  - Reading needs `banking.view`.
  - Importing, matching, explaining and undoing need `banking.edit`. These also work while the workspace is read-only, because they post nothing.
  - Recording a line needs `banking.post`. It goes through the normal expense and journal postings, with their checks, including closed months.

## Tests

- `backend/tests/test_bank_reconciliation_postgres.py`:
  - **Import:** the guessed layout on a Nigerian-style statement; lines before the books left out; a repeated file refused; an overlapping statement adding only its new line; the remembered layout; a wrong date order refused; amounts written different ways.
  - **Working the lines:** matching a recorded expense; confirming a waiting transfer; recording a bank charge and other income; explaining; the month reconciling; undo.
- `src/tests/security/bank-reconciliation-ui.test.tsx`:
  - Importing with guessed columns.
  - Each action on a line.
  - A business with no bank account.
