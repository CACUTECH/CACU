'use server';
// CACU support's own page (Doc 10 E22 part 4): the businesses whose Owner has granted access now, and opening one.
// The database decides: only listed support staff, after the second step, and every opening is recorded.
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_BUSINESS_COOKIE } from '@/lib/business-selection';
import { supportError, type SupportCases } from '@/lib/support-access';

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function supportCasesAction(): Promise<Result<SupportCases>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('support_cases');
  if (error || !data) return { success: false, error: supportError(error?.message) };
  return { success: true, data: data as SupportCases };
}

export async function openSupportCaseAction(businessId: string): Promise<Result<{ business_id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('open_support_case', { p_business_id: businessId });
  if (error || !data) return { success: false, error: supportError(error?.message) };
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
  return { success: true, data: { business_id: businessId } };
}
