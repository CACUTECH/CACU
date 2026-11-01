# R1 Chart of accounts edits - implementation review

## Scope

This item covers FR-131 and Doc 11's account endpoints. Owners and Admins can add, rename, archive and restore accounts, both before and after the books go live.

Doc 09 section 4 sets the rule: "Accounts marked system carry a purpose that automatic postings depend on and cannot be archived."

There is one migration, `20261101150000_chart_edits.sql`. If Supabase records a different version when it is applied, rename the file to match.

## Change

- **`public.save_account`** (Owner or Admin) handles four operations: add, rename, archive and restore. It writes `public.audit_logs` (`ACCOUNT_ADDED`, `_RENAMED`, `_ARCHIVED` and `_RESTORED`).
  - **Add.** The owner picks a plain-language kind, such as "Another bank account" or "A running cost". Each kind sets:
    - the account type, ledger type, cash-flow section and purpose
    - a code band. The next free code in the band is assigned; for example, the next cost after 6900 is 6910 and the next bank account after 1020 is 1021.
  - **Add rules.** Names are unique, ignoring case. A retry with the same request key replays the first result.
  - **Added bank accounts** carry the `bank` purpose, so they appear wherever a bank account is chosen for payments.
  - **Rename.** It renames the ledger account as well.
  - **Archive.** It is refused for system accounts, and for any account with a balance in the books. An archived account can't be posted to and drops out of the expense and bank choices until it is restored.
- **Accounts added before the books start** are stored with their kind. Activation now includes them, where it previously only mapped accounts it found in the template.
- **Accounts added after go-live** need a ledger account, so they go through `POST /accounts`. The accounting API creates the ledger account, then `accounting.map_custom_account` links the two.
  - It only accepts an account the business added: active, not yet linked, and with a ledger account of the same type in this business's live books.
  - Only the runtime can call it, for an Owner or Admin.
  - Adding through the browser function while the books are live is refused (`USE_ACCOUNTING_API`).
- **Chart screen:**
  - an Add an account form
  - Rename on every account
  - Archive or Restore on non-system accounts
  - system accounts labelled "Used by automatic postings"
- **Trial balance** now shows account names as they appear in the chart. The ledger library stores its own title-cased copy, such as "Utilities And Power".

## For the reviewer

1. **The list of kinds and their code bands is a proposal.** In particular, added income posts as operating revenue, and added costs as operating or other expenses.
2. **Accounts can't be deleted, only archived.** An account with a balance must be emptied with a journal first.
3. **Changing a kind isn't allowed after adding.** A mistaken kind is archived and the account added again.

## Verification

- `test_chart_edits_postgres.py`, 14 cases:
  - **Adding:** codes are numbered within each kind, a retry replays, and the chart flags system and added accounts. Refusals cover a duplicate name (including a template name in a different case), a blank name, an unknown kind and a chart that wasn't adopted.
  - **Permissions:** Editors, Viewers and outsiders are refused.
  - **Before go-live:** rename, archive and restore work, and system accounts can't be archived.
  - **Activation:** an account added before go-live is mapped.
  - **After go-live:**
    - Adding through the browser function is refused, and adding is refused for Editors.
    - The API adds once even on a retry. The new account can be posted to, and an added bank account appears in the bank choices.
    - A rename shows on the trial balance, an account with a balance can't be archived, and an archived account can't be posted to.
    - The link function refuses template accounts, accounts that are already linked, and Editors.
- Browser component tests:
  - System accounts show no Archive button.
  - Adding, renaming with a duplicate-name message, archiving and restoring all work.

## Release steps

Merge after supplier bills. Apply the migration on staging, then production.
