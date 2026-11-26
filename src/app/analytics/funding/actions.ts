'use server';
// Funding readiness (Doc 15; E19 R3 parts 1 and 2). The accounting API checks CACU's switch, the plan and who may see the ledger.
import { z } from 'zod';
import { accountingRequest } from '@/lib/accounting-client';
import type { Assessment, FundingOverview } from '@/lib/funding-readiness';

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function fundingOverviewAction(): Promise<Result<FundingOverview>> {
  try { return { success: true, data: await accountingRequest<FundingOverview>('funding-readiness') }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Funding readiness is unavailable. Try again.' }; }
}

export async function fundingAssessAction(): Promise<Result<Assessment>> {
  try { return { success: true, data: await accountingRequest<Assessment>('funding-readiness/assessments', { method: 'POST' }) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The assessment could not be made. Try again.' }; }
}

/** One past assessment in full (Oga and Chairman: history). */
export async function fundingAssessmentAction(id: string): Promise<Result<Assessment>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Assessment not found' };
  try { return { success: true, data: await accountingRequest<Assessment>(`funding-readiness/assessments/${encodeURIComponent(parsed.data)}`) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The assessment could not be opened. Try again.' }; }
}
