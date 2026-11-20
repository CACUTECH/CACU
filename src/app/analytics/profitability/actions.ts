'use server';
// Management profitability (E15 R3). The accounting API checks who may see the ledger.
import { accountingRequest } from '@/lib/accounting-client';
import type { Profitability } from '@/lib/profitability';

export async function profitabilityAction(start: string, end: string): Promise<{ success: true; data: Profitability } | { success: false; error: string }> {
  try { return { success: true, data: await accountingRequest<Profitability>(`reports/profitability?${new URLSearchParams({ start_date: start, end_date: end })}`) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The report is unavailable. Try again.' }; }
}
