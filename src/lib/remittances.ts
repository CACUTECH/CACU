// Payroll remittances (E21 R4): the schedules sent with each remittance, grouped from an approved run's payslips.
// PAYE goes to the state the employee is taxed in; pension to their Pension Fund Administrator; NHF to the Federal
// Mortgage Bank; NHIS to the health insurer. The layout is CACU's own until each authority's format is confirmed.
export const TAX_STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi',
  'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'] as const;
export type TaxState = typeof TAX_STATES[number];

export type RemittanceDetails = { tax_state: TaxState | null; pfa: string | null };
export type SchedulePayslip = { employee_id: string; name: string; tax_id: string | null; pension_pin: string | null; tax_state: TaxState | null;
  pfa: string | null; gross: number; taxable_monthly: number; paye: number; pension_employee: number; pension_employer: number; nhf: number; nhis: number };
export type RemittanceSchedule = { run: { id: string; period: string; employee_count: number }; payslips: SchedulePayslip[];
  totals: { paye: number; pension: number; nhf: number; nhis: number } };

export type Group = { to: string | null; rows: SchedulePayslip[]; total: number };
export type Schedules = {
  paye: Group[]; pension: Group[]; nhf: SchedulePayslip[]; nhis: SchedulePayslip[];
  /** Who still needs details before a schedule can be sent. */
  missing: { tax_state: string[]; tax_id: string[]; pfa: string[]; pension_pin: string[] };
};

const kobo = (n: number) => Math.round(Number(n) * 100);
const sum = (rows: SchedulePayslip[], pick: (r: SchedulePayslip) => number) => rows.reduce((t, r) => t + kobo(pick(r)), 0) / 100;

function groupBy(rows: SchedulePayslip[], key: (r: SchedulePayslip) => string | null, amount: (r: SchedulePayslip) => number): Group[] {
  const groups = new Map<string | null, SchedulePayslip[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  // Named recipients in order; the rows with no recipient last, so they stand out.
  return [...groups.entries()].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a.localeCompare(b))
    .map(([to, list]) => ({ to, rows: list, total: sum(list, amount) }));
}

export function buildSchedules(schedule: RemittanceSchedule): Schedules {
  const all = schedule.payslips;
  const pension = all.filter(r => kobo(r.pension_employee) + kobo(r.pension_employer) > 0);
  return {
    paye: groupBy(all, r => r.tax_state, r => r.paye),
    pension: groupBy(pension, r => r.pfa, r => Number(r.pension_employee) + Number(r.pension_employer)),
    nhf: all.filter(r => kobo(r.nhf) > 0),
    nhis: all.filter(r => kobo(r.nhis) > 0),
    missing: {
      tax_state: all.filter(r => !r.tax_state).map(r => r.name),
      tax_id: all.filter(r => !r.tax_id).map(r => r.name),
      pfa: pension.filter(r => !r.pfa).map(r => r.name),
      pension_pin: pension.filter(r => !r.pension_pin).map(r => r.name),
    },
  };
}

/** A CSV cell: quoted, and never read as a formula by a spreadsheet (a leading =, +, -, @, tab or return). */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const money = (n: number) => (kobo(n) / 100).toFixed(2);

export function payeCsv(period: string, group: Group): string {
  const lines = [['Period', 'State', 'Employee', 'Tax ID', 'Gross pay', 'Taxable pay (monthly)', 'PAYE']];
  for (const r of group.rows) lines.push([period, group.to ?? 'State not set', r.name, r.tax_id ?? '', money(r.gross), money(r.taxable_monthly), money(r.paye)]);
  lines.push([period, group.to ?? 'State not set', 'Total', '', '', '', money(group.total)]);
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function pensionCsv(period: string, group: Group): string {
  const lines = [['Period', 'PFA', 'Employee', 'Pension PIN', 'Employee contribution', 'Employer contribution', 'Total']];
  for (const r of group.rows) lines.push([period, group.to ?? 'PFA not set', r.name, r.pension_pin ?? '', money(r.pension_employee), money(r.pension_employer),
    money(Number(r.pension_employee) + Number(r.pension_employer))]);
  lines.push([period, group.to ?? 'PFA not set', 'Total', '', '', '', money(group.total)]);
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function simpleCsv(period: string, label: 'NHF' | 'NHIS', rows: SchedulePayslip[]): string {
  const pick = (r: SchedulePayslip) => label === 'NHF' ? r.nhf : r.nhis;
  const lines = [['Period', 'Employee', label], ...rows.map(r => [period, r.name, money(pick(r))]), [period, 'Total', money(sum(rows, pick))]];
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
