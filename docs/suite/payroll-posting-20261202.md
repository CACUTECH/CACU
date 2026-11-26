# Payroll to the books (E21 R4, FR-203)

Payroll runs, payslips and approval already exist (`hr_write`; Nigeria Tax Act 2025 defaults, Pension Reform Act 2014, NHF). This part takes an approved run into the ledger.

The owner chose, on 2026-11-26:

- a separate **Post** step after approval;
- recording **paying staff** and **remitting** each deduction, not only the journal;
- a **CACU switch, off** until a professional validates payroll posting.

## Off until the R4 gate

`accounting.payroll_switch` starts off. The R4 release gate needs two things before it is turned on:

- payroll posting fixtures validated by a professional;
- statutory sign-off for Nigeria.

Turning the switch on is a reviewed production change. While it is off:

- the API refuses posting: "Posting payroll to the books is not available yet.";
- the run screen shows nothing extra.

## Posting a run

`POST /api/v1/businesses/{id}/payroll/runs/{run_id}/post` with a `request_key`.

- **Who:** an Owner or Admin with `payroll.approve`.
- **What:** only an approved run.
- **How:** the journal is built from the run's own totals, read through `accounting.payroll_run`. That definer function is needed because the accounting API cannot read the HR tables, which hold salaries.

| Debit | Credit |
| --- | --- |
| Salaries and wages: gross pay | Salaries payable (2300): net pay owed to staff |
| Employer pension contributions (6020): employer pension | PAYE payable (2310) |
| | Pension payable (2320): employee and employer |
| | NHF payable (2330) |
| | NHIS payable (2340) |

- **Salaries and wages** is the default chart's 6000. A business without it gets `payroll_salaries` (6010).
- **Accounts are added on first post.** The payroll accounts join the chart the first time a business posts, and only those the run needs. They are system kinds in `onboarding_private.account_kinds`.
- **Date:** the last day of the payroll month, or today if that is still to come. A month before the books started in CACU is refused; record it in the opening position instead. A closed month is refused by the ledger.
- **It must add up.** Gross pay plus employer pension must equal net pay plus every deduction, or the run is refused.
- **Once only.** Posting again returns what was posted. `accounting.payroll_posting` keeps the run's totals and the journal, and is never changed.
- **A posted run cannot be cancelled in HR.** A trigger on `hr_payroll_runs` refuses it (`PAYROLL_RUN_POSTED`); reverse the journal instead.

## Paying staff and remitting

`POST …/payroll/runs/{run_id}/payments` records one payment, with:

- **`kind`**: `net_pay`, `paye`, `pension`, `nhf` or `nhis`;
- **`amount`**;
- **`entry_date`**;
- **`method`**: `Cash` (the till) or `Transfer` with a reviewed `bank_account_id`;
- **`reference`** (optional).

Each payment debits what it clears and credits the till or bank:

| Kind | Clears |
| --- | --- |
| `net_pay` | Salaries payable |
| `paye` | PAYE payable |
| `pension` | Pension payable |
| `nhf` | NHF payable |
| `nhis` | NHIS payable |

- **Never more than is still owed.** Part payments are allowed: "Only ₦20,000.00 is still owed for this."
- **Dates:** a payment can't be dated before the payroll it pays, or in the future.
- **Retries are safe.** A retried request key records nothing twice.
- **Fixed once made.** `accounting.payroll_settlement` is never changed.

The three posting kinds (`payroll`, `payroll_payment`, `payroll_remittance`) are internal. The generic postings route refuses them. `post_command` also checks their shape: the right main account, side and liability accounts.

## Seeing it

`GET …/payroll/books` returns:

- the approved runs;
- for each run, whether it is posted, what is still owed by kind, and the payments recorded;
- the till and bank accounts payroll can be paid from.

An approved run's page shows **Payroll in the books**:

- **Before posting:** a **Post to the books** button.
- **After posting:** what is still to pay, a form to record a payment, and the payments recorded.

People without `payroll.approve` don't see the panel.

## To check before release

- **Professional validation** of the journal pattern above, with worked fixtures, including:
  - employer pension as an expense;
  - NHIS as an employee deduction;
  - dating at the end of the month.
- **The definer guard.** The guard reads `accounting.payroll_posting`, which has forced row-level security. This relies on the migration role bypassing RLS in production, as other definer functions already do.
- **Remittance schedules** (PAYE to the state, pension per PFA) are not produced yet. Paying is recorded per kind for the whole run.
