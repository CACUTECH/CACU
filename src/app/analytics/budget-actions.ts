'use server';
// Budgets (E14 R3 part 3). The accounting API checks who may set them and which accounts.
import { accountingRequest } from '@/lib/accounting-client';
import type { Budget, Comparison } from '@/lib/budgets';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : 'That did not work. Try again.' });

export async function budgetAction(year: number): Promise<Result<Budget>> {
  try { return { success: true, data: await accountingRequest<Budget>(`budgets/${year}`) }; } catch (error) { return failed(error); }
}
export async function saveBudgetAction(year: number, lines: { account_id: string; months: string[] }[]): Promise<Result<Budget>> {
  try { return { success: true, data: await accountingRequest<Budget>(`budgets/${year}`, { method: 'POST', body: { lines } }) }; } catch (error) { return failed(error); }
}
export async function comparisonAction(month: string): Promise<Result<Comparison>> {
  try { return { success: true, data: await accountingRequest<Comparison>(`reports/budget-vs-actual?${new URLSearchParams({ month })}`) }; } catch (error) { return failed(error); }
}
