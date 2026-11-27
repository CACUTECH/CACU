// Company income tax estimate (R4; Nigeria Tax Act 2025), as the accounting API returns it. An estimate only.
export type IncomeTaxEstimate = {
  year: number; small_company: boolean; not_small_because: string[]; turnover: string; fixed_assets: string;
  steps: { label: string; amount: string }[];
  period: { start: string; end: string; year_end_month: number };
  wht: { credited: string; used: string; carried_forward: string; awaiting_certificate: string; awaiting_count: number };
  income_tax_to_pay: string;
  companies_income_tax: string; development_levy: string; total_due: string; cit_rate_percent: string; levy_rate_percent: string;
  small_turnover: string; small_fixed_assets: string; losses_carried_forward: string; allowances_carried_forward: string;
  told: { losses_brought_forward: string; professional_services: boolean };
  adjustments: { id: string; direction: 'add' | 'deduct'; label: string; amount: string }[];
  books: TaxBooks;
  reviewed: boolean; note: string;
};

export type TaxBooks = {
  posted: { id: string; entry_date: string; companies_income_tax: string; development_levy: string; wht_used: string; payable: string; transaction_id: number; posted_at: string } | null;
  payments: { id: string; amount: string; entry_date: string; paid_from: string; reference: string | null; reversed: boolean; reversal_reason: string | null }[];
  outstanding: string | null;
  reversed: { payable: string; reversed_at: string; reason: string }[];
};
