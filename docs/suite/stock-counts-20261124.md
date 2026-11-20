# Stock counts (Doc 18 R3 "E09 counts and batches", part 1)

**Where it comes from in the specification:**
- **Doc 18 R3:** "E09 counts and batches".
- **Doc 09:** PR-20 (stock adjustments post to Inventory adjustments and write-offs, 5100), and month-end checklist step 4: "stock count or review completed if the business tracks stock; variances posted".

**Owner decision of 18 November 2026:**
- Anyone with stock permission enters counted quantities.
- An Owner or Admin approves the whole count once, which posts every difference.
- The person who submitted the count can't approve it.

Batches and expiry dates (sold earliest-expiry first) are part 2.

## What happens

**Stock › Stock counts** (`/inventory/counts`):

1. **Start a count.** It lists every active product whose stock is tracked, with the quantity the books expect. A count covers one outlet, or the whole business when it has no outlets. Only one count can be open per outlet at a time.
2. **Enter counted quantities.** Saving partway through is fine. An item left empty isn't counted and won't change.
3. **Submit for approval.** The expected quantities are taken again at that moment, so sales and other movements made while counting are allowed for. At least one item must be counted.
4. **Approve and post, or reject.** An Owner or Admin with `inventory.approve`, who isn't the person who submitted the count, decides.
   - **Approving** posts each difference as a stock adjustment, dated that day, at the counted outlet, with the reason "Stock count: <name>". It goes through the existing adjustment posting, so stock quantities, valuation and the ledger move together (inventory against 5100). Each item's own approval limit doesn't apply, because the count is approved as a whole.
   - **Rejecting** needs a note. Nothing is posted, and a new count can be started.

**Month close:** an approved count in the month now ticks step 4, "Stock counted or reviewed". It still needs answering by hand when there was no count.

## How it is stored and enforced

- **Tables:**
  - `accounting.stock_count`: who started, submitted and decided, when, and the note. A partial unique index allows one open count per outlet. A check stops the decider being the submitter.
  - `accounting.stock_count_line`: each item's expected and counted quantity, and the adjustment it posted.
- **Each difference is an ordinary `accounting.stock_adjustment`.** So the stock history, valuation events and audit trail show counts like any other adjustment. It's refused in a closed month, or where the change would take stock below zero.
- **Permissions:** viewing needs `inventory.view`; counting and submitting need `inventory.create`; approving or rejecting needs `inventory.approve` and the Owner or Admin role.

## Tests

- `backend/tests/test_stock_counts_postgres.py`:
  - One open count at a time, and an uncounted item left alone.
  - Only an Owner or Admin approves, posting the difference to stock and 5100.
  - The month-end step answered.
  - The submitter can't approve, and a rejection needs a note.
  - Sales during the count are allowed for.
- `src/tests/security/stock-counts-ui.test.tsx`: entering and submitting counts, approval, starting a count, and quantities typed wrongly.
