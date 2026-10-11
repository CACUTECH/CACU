"use server";
import { getCashFlow } from '@/lib/accounting-client';
export async function getCashFlowAction(start: string, end: string) {
  try { return { success: true as const, data: await getCashFlow(start, end) }; }
  catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Cash flow unavailable' }; }
}

export async function getAccountingModeAction() {
  const { usesPythonAccounting } = await import('@/lib/accounting-client');
  return usesPythonAccounting();
}
