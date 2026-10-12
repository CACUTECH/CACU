'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_BUSINESS_COOKIE, selectMembership } from '@/lib/business-selection';

export async function getBusinessSelectionAction() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { memberships: [], active: null };
  const { data, error: membershipError } = await supabase.from('memberships')
    .select('business_id, role, businesses (*)').eq('user_id', user.id).eq('is_active', true);
  if (membershipError) throw new Error('Unable to load business memberships');
  const memberships = data ?? [];
  const selected = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  let active = null;
  try { active = selectMembership(memberships, selected); } catch { /* Prompt for a fresh selection. */ }
  return { memberships, active };
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