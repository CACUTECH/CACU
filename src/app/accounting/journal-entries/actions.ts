"use server";
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { PostedEntry, ReversalInput } from '@/lib/corrections';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import type { components } from '@/lib/accounting-contract';
export async function getPostingAccountsAction() {
  const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
  const { data, error } = await supabase.from('accounts').select('id,name').eq('business_id', businessId).eq('is_active', true).order('code');
  if (error) throw new Error('Accounts unavailable'); return data || [];
}
export async function postJournalAction(draft: components['schemas']['JournalDraft'] & { request_key: string }) {
  try { return { success: true as const, data: await accountingRequest('journals', { method: 'POST', body: draft }) }; }
  catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Posting unavailable' }; }
}
export async function listJournalsAction() {
  try {
    if (!(await usesPythonAccounting())) return { success: true as const, data: { native: false, journals: [] as PostedEntry[] } };
    return { success: true as const, data: { native: true, journals: await accountingRequest<PostedEntry[]>('journals') } };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Journals unavailable', uncertain: false }; }
}
export async function reverseJournalAction(id: string, input: ReversalInput) {
  try { return { success: true as const, data: await accountingRequest<{ id: string }>(`journals/${encodeURIComponent(id)}/reversal`, { method: 'POST', body: input }) }; }
  catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Reversal not confirmed', uncertain: !(error instanceof AccountingRequestError && error.status < 500) }; }
}
