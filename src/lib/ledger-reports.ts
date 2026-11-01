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
export type StatementSection = { key: string; title: string; total: string[];
  lines: { account_id: string | null; code: string | null; name: string; amounts: string[] }[] };
export type FinancialStatements = Labels & {
  periods: { start_date: string; end_date: string }[]; compare: 'prior' | 'last_year' | null; exceptions: { check: string; message: string }[];
  income_statement: { sections: StatementSection[]; gross_profit: string[]; net_profit: string[] };
  financial_position: { sections: StatementSection[]; total_assets: string[]; total_liabilities: string[]; total_equity: string[]; difference: string[] };
};
