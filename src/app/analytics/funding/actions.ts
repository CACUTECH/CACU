'use server';
// Funding readiness (Doc 15; E19 R3 parts 1 and 2). The accounting API checks CACU's switch, the plan and who may see the ledger.
import { z } from 'zod';
import { accountingRequest } from '@/lib/accounting-client';
import type { Assessment, FundingOverview, FundingShare, ShareDraft, SharePreview } from '@/lib/funding-readiness';

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

// Part 3 (FRA-006..008): the owner previews exactly what will be shared, then confirms; the link expires and can be withdrawn.
const draft = z.object({
  assessment_id: z.string().uuid().optional(),
  recipient_name: z.string().trim().min(2, 'Enter who the pack is for.').max(120),
  recipient_organisation: z.string().trim().max(120).optional().nullable().transform(v => v ? v : null),
  purpose: z.string().trim().min(3, 'Say what the pack is for.').max(300),
  expires_in_days: z.number().int().min(1).max(90),
});

export async function fundingSharePreviewAction(input: ShareDraft): Promise<Result<SharePreview>> {
  const parsed = draft.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' };
  try { return { success: true, data: await accountingRequest<SharePreview>('funding-readiness/shares/preview', { method: 'POST', body: parsed.data }) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The pack could not be prepared. Try again.' }; }
}

export async function fundingShareAction(input: ShareDraft, packSha256: string, requestKey: string): Promise<Result<FundingShare>> {
  const parsed = draft.safeParse(input);
  const hash = z.string().regex(/^[0-9a-f]{64}$/).safeParse(packSha256);
  const key = z.string().uuid().safeParse(requestKey);
  if (!parsed.success || !hash.success || !key.success) return { success: false, error: 'Look at the pack again before you share it.' };
  try {
    return { success: true, data: await accountingRequest<FundingShare>('funding-readiness/shares',
      { method: 'POST', body: { ...parsed.data, pack_sha256: hash.data, request_key: key.data } }) };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The pack could not be shared. Try again.' }; }
}

export async function fundingSharesAction(): Promise<Result<FundingShare[]>> {
  try { return { success: true, data: await accountingRequest<FundingShare[]>('funding-readiness/shares') }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Shared packs could not be loaded.' }; }
}

export async function fundingWithdrawAction(id: string): Promise<Result<FundingShare>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { success: false, error: 'Shared pack not found' };
  try { return { success: true, data: await accountingRequest<FundingShare>(`funding-readiness/shares/${encodeURIComponent(parsed.data)}/withdraw`, { method: 'POST' }) }; }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'The link could not be withdrawn. Try again.' }; }
}
