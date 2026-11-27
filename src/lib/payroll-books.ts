// Payroll to the books (Doc 03 FR-203; E21 R4): what the accounting API returns for a run's journal and payments.
export type SettlementKind = 'net_pay' | 'paye' | 'pension' | 'nhf' | 'nhis';
export type PayrollRunTotals = { id: string; period: string; status: string; employee_count: number; gross_total: number; net_total: number;
  paye_total: number; pension_employee_total: number; pension_employer_total: number; nhf_total: number; nhis_total: number };
export type PayrollBooksRun = {
  run: PayrollRunTotals;
  posted: { entry_date: string; posted_at: string; transaction_id: number } | null;
  outstanding: Record<SettlementKind, string> | null;
  settlements: { id: string; kind: SettlementKind; label: string; amount: string; entry_date: string; paid_from: string; reference: string | null; reversed?: boolean; reversal_reason?: string | null }[];
};
export type PayrollBooks = { enabled: boolean; message: string | null; runs: PayrollBooksRun[];
  pay_from: { cash: boolean; banks: { id: string; name: string }[] } };
export type SettleInput = { kind: SettlementKind; amount: string; entry_date: string; method: 'Cash' | 'Transfer'; bank_account_id?: string | null; reference?: string | null };

/** What each payment clears, in the order an owner usually pays them. */
export const SETTLEMENT_LABELS: Record<SettlementKind, string> = {
  net_pay: 'Net pay to staff', paye: 'PAYE to the tax authority', pension: 'Pension to the pension fund administrators',
  nhf: 'NHF to the Federal Mortgage Bank', nhis: 'NHIS to the health insurer',
};
