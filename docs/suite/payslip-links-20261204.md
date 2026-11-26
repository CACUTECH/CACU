# Payroll remittances, part 2: payslips employees can open (E21 R4)

Part 1 covered where deductions go and the remittance schedules. This part lets an Owner or Admin send each employee their approved payslip as a private link, which opens without an account.

## What the business does

On an approved run's page, the **Payslips for staff** card lists every payslip:

- **Share link** makes a link that works for 7, 30 (the default) or 90 days.
  - The link is shown once, with **Copy link** and **Send on WhatsApp**. CACU sends nothing itself.
- Each employee's status shows: not shared; shared, with the end date and how many times it was opened; or expired.
- **New link** replaces the old one, which stops working.
- **Withdraw** stops the link at once.

## What the employee sees (`/payslip/<token>`)

- The business's name and address, and the month.
- Their name and job title.
- Their tax ID and pension PIN, shown by the last 4 characters only.
- Their state and PFA.
- Earnings: basic, housing, transport, other and gross.
- Deductions: PAYE, their pension share, NHF and NHIS.
- Net pay.
- The employer's pension contribution, and their taxable pay for the year.

Nothing else about the employee is shown: no email, phone, bank details or internal ids. The page is never indexed and sends no referrer.

A link that is unknown, withdrawn, expired or for a run that is not approved shows "Payslip not available".

## Why it is guarded more tightly than a receipt link

A payslip holds pay and identity numbers. So:

- the token is 64 hex characters, and only its SHA-256 is stored (`public.hr_payslip_links`), so the table never holds a working link;
- nobody reads or writes that table directly, not even Owners: only the four functions below can;
- each payslip has at most one live link;
- links expire after at most 90 days;
- each share and withdrawal is recorded in the employee's HR history (`payslip.shared` and `payslip.withdrawn`);
- each opening is counted, with the first and last time it was opened.

## Functions

| Function | Who | Does |
| --- | --- | --- |
| `hr_share_payslip(business, payslip, days)` | Owner, Admin | A new link for an approved payslip, replacing any live one; returns the token once |
| `hr_withdraw_payslip_link(business, payslip)` | Owner, Admin | Withdraws the live link |
| `hr_payslip_links(business, run)` | Owner, Admin | The status of each live link in a run, never the tokens |
| `public_payslip(token)` | Anyone with the link | The payslip, while the link is live; counts the opening |

## To check before release (R4 gate)

- **Content:** whether a payslip needs more, such as the employer's tax ID or the year-to-date totals.
- **Privacy notice:** whether staff should be told, in the business's privacy notice, that payslips are shared by link (NDPA 2023).
- **Sending:** whether CACU should send payslips by email or text later. That would use the message queue and its monthly limits.
