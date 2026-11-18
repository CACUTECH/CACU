// Budgets (FR-137, FR-145; E14 R3 part 3): what the accounting API returns for the budget and the comparison.
export type BudgetAccount = { id: string; code: string | null; name: string; type: string; kind: 'income' | 'expense'; months: string[]; total: string };
export type Budget = { fiscal_year: number; months: string[]; saved_at: string | null; accounts: BudgetAccount[] };
export type Figures = { budget: string; actual: string; difference: string; percent: string | null; on_track: boolean };
export type ComparisonLine = { account_id: string; code: string | null; name: string; kind: 'income' | 'expense'; month: Figures; year_to_date: Figures };
export type Comparison = { month: string; fiscal_year: number; year_from: string; has_budget: boolean; lines: ComparisonLine[];
  totals: Record<'income' | 'expense' | 'profit', { month: Figures; year_to_date: Figures }> };

const kobo = (value: string) => Math.round(Number(value || '0') * 100);
/** A yearly amount spread over twelve months to the kobo; the last month takes the remainder so the months add up. */
export function spread(total: string): string[] {
  const all = kobo(total), each = Math.floor(all / 12);
  return Array.from({ length: 12 }, (_, i) => ((i === 11 ? all - each * 11 : each) / 100).toFixed(2));
}
export const sum = (months: string[]) => (months.reduce((s, m) => s + kobo(m), 0) / 100).toFixed(2);
export const validAmount = (value: string) => /^\d{1,13}(\.\d{1,2})?$/.test(value.trim());
export const shortMonth = (month: string) => new Date(`${month}T12:00:00`).toLocaleDateString('en-NG', { month: 'short' });
