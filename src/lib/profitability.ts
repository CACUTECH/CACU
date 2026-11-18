// Management profitability (Doc 09 statement set; E15 R3): what the accounting API returns.
export type ProfitRow = { name: string; revenue: string; cost: string; profit: string; margin: string | null; item_id?: string; kind?: 'product' | 'service'; quantity?: number };
export type JobProfit = { job_id: string; number: string; revenue: string; materials: string; labour: string; profit: string; unrated: number };
export type Profitability = { start_date: string; end_date: string; label: string; items: ProfitRow[]; outlets: ProfitRow[]; jobs: JobProfit[] | null; totals: ProfitRow };
export const naira = (v: string) => {
  const n = Number(v);
  return `${n < 0 ? '−' : ''}₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
