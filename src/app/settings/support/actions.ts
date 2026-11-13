'use server';
// Support access for the Owner (Doc 10 E22 part 4): the database checks the owner, the length and the reason.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { supportError, type SupportStatus } from '@/lib/support-access';

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function call(fn: 'support_access_status' | 'grant_support_access' | 'end_support_access',
  args: Record<string, string | number | boolean> = {}): Promise<Result<SupportStatus>> {
  try {
    const supabase = await createClient();
    const businessId = await getActiveBusinessIdAction();
    const { data, error } = await supabase.rpc(fn, { p_business_id: businessId, ...args });
    if (error || !data) return { success: false, error: supportError(error?.message) };
    if (fn !== 'support_access_status') revalidatePath('/settings/support');
    return { success: true, data: data as SupportStatus };
  } catch {
    return { success: false, error: 'Select your business and try again.' };
  }
}

export async function supportStatusAction() { return call('support_access_status'); }
export async function grantSupportAction(hours: number, reason: string, includePay: boolean) {
  return call('grant_support_access', { p_hours: hours, p_reason: reason, p_include_pay: includePay });
}
export async function endSupportAction() { return call('end_support_access'); }
