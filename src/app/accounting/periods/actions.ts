'use server';
// Month close and reopen (FR-135). The accounting API checks the permissions, the order and the checklist.
import { accountingRequest } from '@/lib/accounting-client';
import { monthKey, type Answer, type PeriodOverview } from '@/lib/periods';

type Result = { success: true; data: PeriodOverview } | { success: false; error: string };
const failed = (error: unknown): Result => ({ success: false, error: error instanceof Error ? error.message : 'That did not work. Try again.' });

export async function periodsAction(): Promise<Result> {
  try { return { success: true, data: await accountingRequest<PeriodOverview>('periods') }; } catch (error) { return failed(error); }
}

export async function closeMonthAction(month: string, acknowledgements: Record<string, Answer>): Promise<Result> {
  try {
    return { success: true, data: await accountingRequest<PeriodOverview>(`periods/${monthKey(month)}/close`, { method: 'POST', body: { acknowledgements } }) };
  } catch (error) { return failed(error); }
}

export async function reopenMonthAction(month: string, reason: string): Promise<Result> {
  try {
    return { success: true, data: await accountingRequest<PeriodOverview>(`periods/${monthKey(month)}/reopen`, { method: 'POST', body: { reason } }) };
  } catch (error) { return failed(error); }
}
