'use server';
// Key performance indicators (E16 R3). The accounting API checks who may see the ledger.
import { accountingRequest } from '@/lib/accounting-client';
import type { Kpis } from '@/lib/kpis';

export async function kpisAction(start: string, end: string): Promise<{ success: true; data: Kpis } | { success: false; error: string }> {
  try { return { success: true, data: await accountingRequest<Kpis>(`reports/kpis?${new URLSearchParams({ start_date: start, end_date: end })}`) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The figures are unavailable. Try again.' }; }
}
