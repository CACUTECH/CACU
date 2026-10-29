/** Shared HR types, labels and safe error messages. Safe to import from client components. */
/** Stored status codes (employees_employment_status_check) and the labels shown to people. */
export const EMPLOYEE_STATUS_LABELS = { active: 'Active', on_leave: 'On leave', suspended: 'Suspended', exited: 'Departed' } as const;
export type EmployeeStatus = keyof typeof EMPLOYEE_STATUS_LABELS;
export function statusLabel(status: string | null | undefined) {
  return (status && EMPLOYEE_STATUS_LABELS[status as EmployeeStatus]) || status || 'Unspecified';
}
export const HR_OPERATIONS = ['employee.save', 'employee.status', 'employee.depart', 'attendance.check_in', 'attendance.check_out',
  'payroll.rules', 'payroll.create', 'payroll.approve', 'payroll.cancel'] as const;
export type HROperation = typeof HR_OPERATIONS[number];
export type HRMutation = {
  request_key: string;
  operation: HROperation;
  record_id?: string | null;
  expected_version?: number | null;
  details: Record<string, unknown>;
};
export type HRResult = { success: true; data: Record<string, unknown> } | { success: false; error: string; uncertain: boolean };

export type EmployeeRecord = {
  id: string; version: number; full_name: string; job_title: string | null; department: string | null; email: string | null; phone: string | null;
  employment_status: string | null; start_date: string | null; end_date: string | null; departure_reason: string | null;
  pay_basic: string | number | null; pay_housing: string | number; pay_transport: string | number; pay_other: string | number;
  annual_rent: string | number; pension_enrolled: boolean; nhf_enrolled: boolean; nhis_monthly: string | number;
  tax_id: string | null; pension_pin: string | null;
};
export const EMPLOYEE_COLUMNS = 'id,version,full_name,job_title,department,email,phone,employment_status,start_date,end_date,departure_reason,' +
  'pay_basic,pay_housing,pay_transport,pay_other,annual_rent,pension_enrolled,nhf_enrolled,nhis_monthly,tax_id,pension_pin';

export type PayrollBand = { up_to: number | null; rate: number };
export type PayrollRules = {
  source?: string; bands: PayrollBand[]; pension_employee_rate: number; pension_employer_rate: number;
  nhf_rate: number; rent_relief_rate: number; rent_relief_cap: number;
};
export type HistoryEntry = { event: string; fields: string[] | null; created_at: string; actor: string };

const MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'An active Owner or Admin must make HR changes.',
  INVALID_REQUEST: 'The request was incomplete. Refresh and try again.',
  REQUEST_KEY_REUSED: 'This request was already used for a different change. Refresh and try again.',
  UNSUPPORTED_FIELD: 'The request contained a field that cannot be changed here.',
  INVALID_AMOUNT: 'Amounts must be zero or more with at most two decimal places, and HMO/NHIS cannot exceed monthly pay.',
  INVALID_EMPLOYEE: 'Check the employee details: name is required, and email, phone and dates must be valid.',
  EMPLOYEE_NOT_FOUND: 'This employee is not in your active business.',
  VERSION_CONFLICT: 'This record changed elsewhere. Refresh to see the latest version before saving again.',
  INVALID_STATUS: 'Choose a valid employment status.',
  STATUS_UNCHANGED: 'The employee already has that status.',
  OPEN_SHIFT: 'Check the employee out before changing their status.',
  ALREADY_DEPARTED: 'This employee has already departed.',
  INVALID_DEPARTURE: 'Enter a valid last working day (not before the start date) and a reason.',
  EMPLOYEE_NOT_ACTIVE: 'Only active employees can check in.',
  ALREADY_CHECKED_IN: 'This employee is already checked in.',
  NOT_CHECKED_IN: 'This employee is not checked in.',
  INVALID_PAYROLL_RULES: 'Payroll rules are invalid. Rates must be between 0% and 100% and band limits must increase.',
  INVALID_PERIOD: 'Choose a month from January 2026 up to the current month.',
  PAYROLL_PERIOD_EXISTS: 'A payroll run already exists for this month. Cancel the draft to rebuild it.',
  NO_ELIGIBLE_EMPLOYEES: 'No employees in this month have a pay structure. Add pay details to employee records first.',
  PAYROLL_RUN_NOT_FOUND: 'This payroll run is not in your active business.',
  PAYROLL_RUN_LOCKED: 'Only draft payroll runs can be approved or cancelled.',
  PAYROLL_RULES_UNREVIEWED: 'This draft used unreviewed default rules. Review the payroll rules, then cancel and rebuild the draft before approving.',
  PAYROLL_RECORD_IMMUTABLE: 'Approved payroll records cannot be changed.',
  UNKNOWN_OPERATION: 'This HR action is not supported.',
};

/** Maps a database error to a reviewed message; anything unrecognised gets a generic message. */
export function hrErrorMessage(raw: string | undefined | null) {
  const code = /^[A-Z_]+/.exec(raw || '')?.[0];
  return (code && MESSAGES[code]) || 'The HR change could not be saved. Refresh to check whether it was applied.';
}

export function naira(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2 }).format(Number(value));
}

export function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Calendar date in Lagos, the default business timezone, as YYYY-MM-DD. */
export function lagosToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
