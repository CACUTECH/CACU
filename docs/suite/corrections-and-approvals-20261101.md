# R1 Expenses, reversals and stock adjustments with approval - implementation review

## Scope

FR-120 (expenses, PR-17), FR-112 (reverse a manual journal, PR-26) and FR-080 (stock adjustments with approval, PR-20, BR-021). These are the fifth Phase 2 item, for businesses whose books are live. Doc 11 planned three endpoints: `POST /expenses`, `POST /journals/{id}/reversal`, and `POST /stock/adjustments` with `/approve`. All three are added, plus the reads the screens need.

There is one migration, `20261101090000_stock_adjustment_approval.sql`. Expenses and reversals need no new tables.

## Change

- **Expenses** (`cacu/accounting/workflows.py`, `/accounting/expenses`):
  - Owners, Admins and Editors record money paid out: the expense account, the amount, the date, Cash or bank transfer, and a description.
  - It posts the expense account (debit) against cash or the chosen bank account (credit), with the same retry protection as receipts.
  - The account must be one of the business's expense accounts. Cost of goods sold (5000) and inventory write-offs (5100) are excluded, because only stock movements may post to them (Doc 09 controls).
  - Before this change, a live business had no screen to record an expense: Transactions refuses entries once the books are live.
- **Reversals** (`posting.py`, `workflows.py`):
  - Only an Owner or Admin can reverse an entry, and must give a reason.
  - The reversal posts the exact mirror of the original, derived from the ledger. The original is never edited. The reason goes into the reversal's narration, and `accounting.audit_event` records it.
  - Only manual journals and expenses can be reversed:
    - A journal that moved stock is corrected with a new stock adjustment, so the quantity and the ledger stay together.
    - Invoices, bills, their payments and the opening entries are refused.
  - Each entry can be reversed once, and a reversal can't be dated before the original.
  - Two defects in the existing reversal code are fixed:
    - Manual journals are always compound, and compound journals could not be reversed at all.
    - The lookup of the original did not filter by document type. An invoice and its cost-of-sales entry share one source id, so it could pick either.
  - The journal screen lists posted journals, and the Expenses screen lists recent expenses. Both have a Reverse button.
- **Stock adjustments with approval** (`cacu/accounting/stock.py`):
  - **Requesting.** Owners, Admins and Editors can request a change. When the request is made, CACU checks the item, the version, the quantity (it may not go negative) and the date (between the books' start date and today, in an open period), and values the change at the item's cost.
  - **Posting directly.** Owners and Admins post directly unless the business has set a limit and the change is worth more than that limit.
  - **Waiting for approval.** Every Editor request waits, and so does any Owner or Admin request above the limit.
  - **Deciding.** An Owner or Admin approves or rejects. A rejection needs a reason. The requester can withdraw their own request.
  - **Separation of duties.** It is on by default, so nobody approves their own request. The Owner can turn it off for a one-person business (Doc 08).
  - **Approval re-checks.** Approval checks the quantity and the cost again. If the cost changed after the request, approval is refused and a new request is needed.
  - **Posting on approval.** It runs through `management_write`, with the request id as the movement id. Inventory is posted against 5100 Inventory adjustments and write-offs, which PR-20 specifies; before this change it was posted against cost of goods sold. Entities provisioned before the default chart have no 5100 account and keep their cost-of-sales mapping.
  - **Once only.** Each request is decided once; the database refuses any later change to its status.
  - **Old route covered.** The catalog's Adjust stock button uses the same path, so the limit can't be bypassed. Editors see "Request stock change" once the books are live.
  - **Screens.** Inventory shows the waiting list with Approve, Reject and Withdraw buttons, and the Owner's approval rule.
- **API:**
  - `GET /expense-accounts`, `GET /expenses` and `POST /expenses`
  - `GET /journals`, `POST /journals/{id}/reversal` and `POST /expenses/{id}/reversal`
  - `GET /stock/adjustments?status=` and `POST /stock/adjustments`
  - `POST /stock/adjustments/{id}/approve` and `/reject`
  - `GET /approval-policy` and `POST /approval-policy`

## For the owner and reviewer

1. **The default approval rule is a proposal.** With no rule set, Owners and Admins post stock changes directly, as they do today, and only Editor requests wait. Doc 02 leaves the default limit open (BR-021). Please confirm, or name a default limit.
2. **Manual journals can still touch control accounts** (receivables, payables, inventory). Doc 09 says they should not, except for opening balances and accountant-approved corrections. This change leaves `/journals` as it was; restricting it would change existing behaviour, so it needs your decision.
3. **Expenses are paid at once.** Expenses claimed by staff and paid later (Doc 08), and supplier bills, are later items.
4. **Approval is not offered on expenses.** Doc 11 lists approval only for stock adjustments (and refunds in R2).

## Verification

- `test_corrections_postgres.py` (21 cases, on a business turned on from an approved opening position):
  - **Expenses.**
    - An expense posts by cash and by transfer; a retry replays it.
    - Expense refusals post nothing: a cost-of-sales or receivables account, a zero amount, a transfer with no bank account or an unknown bank.
    - Viewers are refused, and Editors cannot reverse.
  - **Reversals.**
    - A reversed expense and a reversed compound journal return every account to where it was, and the trial balance stays balanced.
    - A second reversal is refused.
    - Opening entries, opening invoices, stock journals and unknown ids are refused.
  - **Stock adjustments.**
    - An Owner posts directly to 5100.
    - An Editor's request waits and then posts on an Admin's approval, with the audit trail in order.
    - The threshold works, and so does separation of duties, including turning it off.
    - Rejection needs a reason, withdrawal works, and a decided request can't be changed in the database.
    - Approval refuses when the stock or the cost changed after the request.
    - Invalid requests record nothing.
    - The catalog's adjust button follows the same rules.
- `test_management_postgres.py`: a stock change that would make the quantity negative is now refused with a clear message before the database is touched.
- Browser component tests:
  - an expense with a retried unconfirmed save (same key) and its reversal, at phone width
  - the approvals panel: approve, a reject that needs a note, withdraw, own-request blocking, and saving the rule

## Release steps

1. Merge after Turn on the books.
2. Apply `20261101090000_stock_adjustment_approval.sql` on staging, then run the browser and backend checks there.
3. Production follows only after DEP-01 and DEP-02, like the earlier R1 items.
