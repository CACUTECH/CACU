# R1 API rate limits, contract drift guard and release-gate tests - implementation review

## Scope

This item covers four requirements:
- Doc 11 API-012: rate limits per user and per business, with `429` and `Retry-After`
- Doc 11 API-014: CI catches drift between the API and its committed contract
- Doc 16 SEC-026: posting bursts
- Doc 09 / Doc 19 TEST-101 to TEST-110: the minimum financial tests before an accounting release (gate G2)

There is one migration, `20261101200000_api_rate_limits.sql`. If Supabase records a different version when it is applied, rename the file to match.

## Change

- **Write rate limits:**
  - Before every write, `library_transaction` takes a slot through `accounting.take_write_slot` in its own short transaction, so refused and failed writes count too.
  - The limits are 60 writes a minute per person and 300 a minute per business.
  - Past either limit the API answers `429` with `Retry-After`, set to the seconds left in the minute, and the message "Too many changes in a short time. Try again in N seconds."
  - Only active Owners, Admins and Editors are counted, so an outsider or a viewer cannot use up a business's allowance.
  - Reads aren't limited.
  - The counts live in the database, because the API runs on many short-lived instances; windows older than ten minutes are cleared as it goes.
  - The browser can't read or call any of it.
- **Contract drift guard:**
  - `tests/test_api_contract.py` fails when an API route is missing from `src/lib/accounting-contract.ts`, or when the contract lists a route the API no longer serves. CI already runs the backend tests.
  - It checks paths and methods, not request and response shapes.
  - The contract itself is already current (45 routes), regenerated in the IFRS work.
- **Release-gate tests:** `tests/test_release_gate_postgres.py` adds the missing cases.

## TEST-101 to TEST-110

| ID | Test | Where | Status |
| --- | --- | --- | --- |
| TEST-101 | Every posting rule with a worked NGN fixture | Engine, workflow, activation, corrections, bills and inventory tests cover the R1 rules: PR-01, PR-17 to PR-20, PR-26, sales, receipts, credit notes and cost of sales | Partial: R2 and later rules (deposits, payroll, accruals, transfer clearing) aren't built |
| TEST-102 | ₦100,000 credit sale, ₦40,000 receipt | `test_102_credit_sale_of_100000_with_a_40000_receipt` | Passes: revenue 100,000, cash +40,000, receivables 60,000, cost of sales and stock once |
| TEST-103 | Failure after posting, before commit | `test_outer_rollback_including_upstream_commits`, `test_stock_failure_rolls_back_source_and_ledger` | Passes |
| TEST-104 | Same request key twice; changed amount | `test_idempotency_and_conflict` and every workflow's replay check | Passes |
| TEST-105 | 50 concurrent sales of the last 10 units | `test_105_fifty_concurrent_sales_of_the_last_ten_units` | Passes: exactly 10 sold, 40 refused, stock 0 |
| TEST-106 | Receipt above the outstanding balance | Activation, bills and `test_concurrent_allocation_cannot_overpay` | Passes: refused (R1) |
| TEST-107 | Transfer sale, confirmation, unconfirmed transfer reversed | Not built | Waits for transfer clearing (BL-024) |
| TEST-108 | Posting before cutover or in a closed period | `test_runtime_refuses_postings_before_the_start_date`, `test_108_postings_in_a_closed_period_are_refused_with_the_reason` | Passes |
| TEST-109 | Cash, receivables, payables and stock reconciliations after mixed activity | `test_109_a_month_of_mixed_activity_reconciles` | Passes: every difference zero |
| TEST-110 | Update or delete of a posted ledger row as every role | `test_110_...` (runtime, browser roles, service role, table owner) | Passes: refused, rows unchanged |

TEST-109's fixture covers a credit sale, a part receipt by transfer, a cash sale, two expenses (one reversed), a bill with a part payment, a payment on the opening bill, and a stock write-off. It runs on one day, not over a month. The reconciliation checks are the same either way.

**On "on staging":** the gate asks for these to pass on staging. The fixtures rebuild their schemas and refuse any database that isn't local and named `*_test`, so they must never point at a shared database. Running them "on staging" means a disposable test database built from the staging migrations, which needs the staging project (an owner action).

## For the reviewer

The write limits (60 per person and 300 per business per minute) are a proposal for pilot shops. A busy point of sale makes about one sale every few seconds, well under them.

## Verification

- `test_api_rate_limits_postgres.py`, 6 cases:
  - per-person and per-business limits
  - viewers and outsiders aren't counted
  - the scope must match the business
  - browser roles can't call it
  - end to end, the API answers `429` with `Retry-After`, posts nothing, and still serves reads
- `test_api_contract.py`: the contract matches the API.
- `test_release_gate_postgres.py`: 9 cases, listed in the table above.
