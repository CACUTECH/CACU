# NG-2026.1 standard chart: accountant review record (DEP-02)

## Scope

This records the accountant review of the platform default chart of accounts and posting rules required by Doc 02 DEP-02 and Doc 09 section 4. It covers template `NG-2026.1` for the **R1 accounting pilot only**: Nigeria, NGN, tax disabled.

It does not approve any business's opening balances or mappings. Each business's Owner or Admin still approves those separately (DEC-004, ACC-016).

## Reviewer

| Field | Value |
| --- | --- |
| Name | Oyewale Olayiwola |
| Organisation | CACU Technologies Limited |
| Qualification | ICAN, membership 273917 |
| Capacity | CACU-appointed accountant |
| Signed and dated | 1 November 2026 |

## Material reviewed

The reviewer signed for these, as stated on the review form:
- the technical review findings, in `ng-2026-1-account-review-20261101.md` (SHA-256 `2d5b4331…c3cdde`);
- the account-by-account worksheet, in `ng-2026-1-account-review-20261101.csv` (SHA-256 `ce8dd6d3…3747`);
- posting examples and financial statements;
- IFRS Standards.

The template reviewed is the one created by migration `20261031100000_default_chart_of_accounts.sql`:

| Mode | Accounts |
| --- | --- |
| Product | 28 |
| Hybrid | 28 |
| Service | 24 |

Content fingerprint: `48a5e1fccac6f76a55c758ff86531012`.

## Decisions

All eight review items were marked **"Accepted, passes for CACU requirement"**, with no conditions. For the pilot, that means the current behaviour of each is accepted:

| Item | What is accepted for the pilot |
| --- | --- |
| Account names, codes, types and purpose mappings | As in the template |
| 3900 Opening balance equity | Used for the approved opening position and for stock introduced after go-live (opening stock added through the catalogue). This settles open decision 2 in `corrections-and-approvals-20261101.md` for the pilot |
| Hybrid revenue | Goods and service sales both post to 4000 Sales of goods. 4100 is used only by Service-only businesses |
| Loans | 2500 Loans and borrowings is non-current, with current portions disclosed through the reporting-close maturity schedule |
| Transfers | Transfer sales and receipts post **directly to the chosen bank account**. 1020 Transfers awaiting confirmation stays unused. Clearing (PR-03 to PR-05, BL-024) is deferred and needs its own review when built (clarified by the reviewer on 1 November 2026) |
| Inventory | Moving weighted-average cost, cost of sales on sale, returns at original cost, adjustments and write-offs to 5100, net realisable value allowance |
| Cash flow | Opening position brought forward outside period movements, non-cash investing and financing excluded, interest paid in operating |
| Exclusions | VAT, WHT, payroll posting, customer deposits and fixed-asset workflows are outside this approval |

**Overall decision:** approved for the R1 pilot scope above.

The signed form ticked all four overall-decision boxes. The reviewer clarified on 1 November 2026 that the decision is **Approved, R1 pilot scope**. "Approved scope: All required" is read as the R1 accounting pilot named on the form's header.

## What this does not cover

These are not part of this approval:
- **Later template versions:** anything changed after `NG-2026.1`, and any account added later (`NG-2026.2` onward). The migration refuses to record this review if the template's contents differ from the reviewed fingerprint.
- **Custom accounts:** accounts owners add themselves through chart edits (FR-131). These take their type and cash-flow section from `onboarding_private.account_kinds`.
- **Features built later:**
  - transfer clearing
  - card and gateway settlement
  - deposits and advances
  - VAT and WHT
  - payroll posting
  - fixed assets
- **Statement labels:** this approval doesn't change them. Statements stay "Management statements, not reviewed" until a named accountant reviews a business's actual statements (BR-061).

**Independence:** the reviewer is CACU-appointed and part of CACU, which the form allows. A lender or auditor may later ask for an external review of the platform defaults. That would be recorded as a new review, not by editing this one.

## Recording

- **Recording migration:** `20261101210000_chart_template_review.sql` records the review against `NG-2026.1`:
  - `status = 'reviewed'`
  - `reviewed_by = 'Oyewale Olayiwola (CACU Technologies Limited)'`
  - `reviewed_at = 2026-11-01 00:00 WAT`

  It refuses if:
  - the template's accounts differ from the reviewed fingerprint;
  - the template is not awaiting review.
- **Who can see it:** members see the reviewer's name in the chart screen. The membership number is kept in this record only.
- **Books are not switched on by this.** Setting up books in production still needs:
  - each business's approved opening position;
  - the restricted runtime login (DEP-01);
  - an authorised operator running `tools/activate_books.py` without `--staging-unreviewed`.

## Verification

- `test_default_chart_postgres.py`:
  - the review is recorded with the right reviewer and time;
  - members see it;
  - the provisioning mapping builds without the staging switch;
  - a second run is refused;
  - a changed template is refused and stays pending.
- `test_activation_postgres.py`: books go live on the reviewed template without the staging switch, and the activation evidence shows `template_reviewed: true`.
- Full backend: 430 passed, 16 skipped.

## Release steps

1. Apply `20261101210000_chart_template_review.sql` to production. Production is read-only to agents, so you or an authorised operator applies it. If Supabase records a different version number, rename the file to match.
2. Check, read-only:

   ```sql
   SELECT status, reviewed_by, reviewed_at FROM onboarding_private.chart_templates WHERE version = 'NG-2026.1';
   ```

3. Keep the signed form with CACU's records, and note its location in the form's "Implementation and approval record".
