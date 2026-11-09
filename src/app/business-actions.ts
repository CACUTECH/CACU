'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_BUSINESS_COOKIE, selectMembership } from '@/lib/business-selection';
import type { TwoStepStatus } from '@/lib/two-step';

export async function getBusinessSelectionAction() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { memberships: [], active: null, twoStep: null };
  const { data, error: membershipError } = await supabase.from('memberships')
    .select('business_id, role, businesses (*)').eq('user_id', user.id).eq('is_active', true);
  if (membershipError) throw new Error('Unable to load business memberships');
  const memberships = data ?? [];
  const selected = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  let active = null;
  try { active = selectMembership(memberships, selected); } catch { /* Prompt for a fresh selection. */ }
  return { memberships, active, twoStep: await twoStepStatus(supabase, active?.business_id ?? null) };
}

/** Two-step sign-in (Doc 16 SEC-014): whether this session may use the business, and why not. The database decides
 * the same way when it answers every request, so this only tells the person what to do. */
async function twoStepStatus(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string | null): Promise<TwoStepStatus | null> {
  const { data, error } = await supabase.rpc('mfa_status', { p_business_id: businessId });
  return error || !data ? null : data as TwoStepStatus;
}

export async function getTwoStepStatusAction(): Promise<TwoStepStatus | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { active } = await getBusinessSelectionAction();
  return twoStepStatus(supabase, active?.business_id ?? null);
}

export async function selectBusinessAction(businessId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Authentication required');
  const { data, error: membershipError } = await supabase.from('memberships')
    .select('business_id, role').eq('user_id', user.id).eq('is_active', true).eq('business_id', businessId).single();
  if (membershipError || !data) throw new Error('Business membership required');
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, data.business_id, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getActiveBusinessIdAction(): Promise<string> {
  const { active } = await getBusinessSelectionAction();
  if (!active) throw new Error('Select an authorized active business');
  return active.business_id;
}