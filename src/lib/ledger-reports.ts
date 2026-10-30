/** Trial balance (FR-143) and general ledger (FR-140) shapes returned by the accounting API. */
type Labels = { tier: string; basis: string; currency: string; generated_at: string };
export type ControlException = { check: string; message: string; difference: string };
export type TrialBalance = Labels & {
  as_of: string; total_debit: string; total_credit: string; difference: string; controls_checked: boolean; exceptions: ControlException[];
  lines: { account_id: string; code: string | null; name: string; type: string; debit: string; credit: string }[];
};
export type GeneralLedger = Labels & {
  account: { id: string; code: string | null; name: string }; start_date: string; end_date: string;
  opening_balance: string; total_debit: string; total_credit: string; closing_balance: string;
  entries: { date: string; number: string; description: string; counter_account: string; debit: string; credit: string; balance: string }[];
  page: number; page_size: number; total_entries: number;
};
