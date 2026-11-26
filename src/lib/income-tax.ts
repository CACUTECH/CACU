// Company income tax estimate (R4; Nigeria Tax Act 2025), as the accounting API returns it. An estimate only.
export type IncomeTaxEstimate = {
  year: number; small_company: boolean; not_small_because: string[]; turnover: string; fixed_assets: string;
  steps: { label: string; amount: string }[];
  companies_income_tax: string; development_levy: string; total_due: string; cit_rate_percent: string; levy_rate_percent: string;
  small_turnover: string; small_fixed_assets: string; losses_carried_forward: string; allowances_carried_forward: string;
  told: { losses_brought_forward: string; professional_services: boolean };
  adjustments: { id: string; direction: 'add' | 'deduct'; label: string; amount: string }[];
  reviewed: boolean; note: string;
};
