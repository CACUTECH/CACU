'use server';
// Closing and reopening a business (Doc 10 E22 part 3): the database checks the owner, the typed name and the 90 days.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { closureError, type ClosureStatus } from '@/lib/closure';

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function call(fn: 'close_business' | 'reopen_business' | 'business_closure_status', args: Record<string, string> = {}): Promise<Result<ClosureStatus>> {
  try {
    const supabase = await createClient();
    const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc(fn, { p_business_id: businessId, ...args });
    if (error || !data) return { success: false, error: closureError(error?.message) };
    if (fn !== 'business_closure_status') revalidatePath('/', 'layout');
    return { success: true, data: data as ClosureStatus };
  } catch {
    return { success: false, error: 'Select your business and try again.' };
  }
}

export async function closureStatusAction() { return call('business_closure_status'); }
export async function closeBusinessAction(confirmName: string, reason: string) {
  return call('close_business', { p_confirm_name: confirmName, p_reason: reason });
}
export async function reopenBusinessAction() { return call('reopen_business'); }
