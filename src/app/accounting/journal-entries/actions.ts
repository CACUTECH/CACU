"use server";
import { accountingRequest } from '@/lib/accounting-client';
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
