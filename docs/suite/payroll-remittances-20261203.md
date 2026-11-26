# Payroll remittances, part 1: where deductions go and the schedules (E21 R4)

You chose payroll remittances after payroll posting (FR-203). The work comes in two parts:

1. **Schedules** (this part): each employee's state and Pension Fund Administrator (PFA), and the schedules to send with each payment.
2. **Payslips employees can open** (next).

## Where deductions go

| Deduction | Paid to | Law |
| --- | --- | --- |
| PAYE | The State Internal Revenue Service of the state the employee lives in | Nigeria Tax Act 2025, Nigeria Tax Administration Act 2025 |
| Pension (employee and employer) | The employee's PFA | Pension Reform Act 2014 |
| NHF | The Federal Mortgage Bank | National Housing Fund |
| NHIS | The health insurer | |

So each employee now carries two more facts:

- **State taxed in:** one of the 36 states or the FCT;
- **PFA:** free text, 2 to 80 characters, as on the employee's pension statement.

They are kept in `public.hr_remittance_details`, beside the employee record, so `hr_write` and its validated fields stay unchanged. Only `public.hr_save_remittance_details` changes them.

- **Who:** Owners and Admins, through `management_private.authorize`, as for the rest of HR.
- **History:** each change is recorded in the HR history (`employee.remittance`). A save that changes nothing is not recorded.
- **Access:** nobody writes the table directly. Owners and Admins can read it.

The employee page has a **Where deductions go** card.

## The schedules

`public.hr_remittance_schedule(business, run)` returns an approved run's payslips. Each payslip carries:

- the employee's tax ID and pension PIN;
- their state and PFA;
- gross pay, monthly taxable pay, PAYE, both pension contributions, NHF and NHIS.

It also returns the run's totals. A draft or cancelled run has no schedules, because only approved payslips are fixed.

An approved run's page shows **Remittance schedules**:

- **PAYE by state** and **pension by PFA**, each with its staff count, total and a CSV to download. Unset ones come last.
- **NHF and NHIS**, when any staff pay them.
- **A list of who is missing details**, and why each matters:
  - no state means the PAYE can't be sent to a state;
  - no tax ID means the state can't credit the PAYE;
  - no PFA means the pension can't be sent;
  - no pension PIN means the PFA can't credit the pension.

The CSVs:

- are UTF-8 with a byte-order mark, so Excel reads the naira sign;
- quote every cell;
- never let a cell run as a spreadsheet formula. A leading `=`, `+`, `-`, `@`, tab or return gets a `'`, unless the cell is a plain number.

## To check before release (R4 gate)

- **Upload formats:** each authority's own upload format, for each SIRS (starting with Lagos and FCT), PenCom PFAs and the FMBN. The CSV layout here is CACU's own.
- **Remittance deadlines:** PAYE by the 10th of the following month, and pension within 7 working days. A reminder could follow.
- **Tax residence:** whether a state should come from the employee's address. For now the owner chooses it.
