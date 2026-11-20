'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_BUSINESS_COOKIE, selectMembership } from '@/lib/business-selection';
import type { TwoStepStatus } from '@/lib/two-step';
import type { ClosureStatus } from '@/lib/closure';
import { openedSupportCases } from '@/lib/support-access';

type Client = Awaited<ReturnType<typeof createClient>>;
/** A business the person can use: their membership, or (CACU support) an opened, owner-granted case, read-only. */
export type BusinessMembership = { business_id: string; role: string; businesses: unknown;
  support?: { expires_at: string; include_pay: boolean; reason: string } };

/** CACU support (Doc 10 E22 part 4): cases opened by this support person appear like a viewer's membership. */
async function supportMemberships(supabase: Client, members: { business_id: string }[]): Promise<BusinessMembership[]> {
  const cases = (await openedSupportCases(supabase)).filter(c => !members.some(m => m.business_id === c.business_id));
  if (!cases.length) return [];
  const { data } = await supabase.from('businesses').select('*').in('id', cases.map(c => c.business_id));
  return cases.map(c => ({ business_id: c.business_id, role: 'viewer',
    businesses: (data ?? []).find((b: { id: string }) => b.id === c.business_id) ?? { id: c.business_id, name: c.name },
    support: { expires_at: c.expires_at, include_pay: c.include_pay, reason: c.reason } }));
}

export async function getBusinessSelectionAction() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { memberships: [], active: null, twoStep: null, closure: null };
  const { data, error: membershipError } = await supabase.from('memberships')
    .select('business_id, role, businesses (*)').eq('user_id', user.id).eq('is_active', true);
  if (membershipError) throw new Error('Unable to load business memberships');
  const memberships: BusinessMembership[] = [...(data ?? []), ...await supportMemberships(supabase, data ?? [])];
  const selected = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  let active = null;
  try { active = selectMembership(memberships, selected); } catch { /* Prompt for a fresh selection. */ }
  const twoStep = await twoStepStatus(supabase, active?.business_id ?? null);
  return { memberships, active, twoStep, closure: active ? await closureStatus(supabase, active.business_id) : null };
}

/** Two-step sign-in (Doc 16 SEC-014): whether this session may use the business, and why not. The database decides
 * the same way when it answers every request, so this only tells the person what to do. */
async function twoStepStatus(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string | null): Promise<TwoStepStatus | null> {
  const { data, error } = await supabase.rpc('mfa_status', { p_business_id: businessId });
  return error || !data ? null : data as TwoStepStatus;
}

/** Closing a business (E22 part 3): whether the active business is closed, so every page can say so. */
async function closureStatus(supabase: Awaited<ReturnType<typeof createClient>>, businessId: string): Promise<ClosureStatus | null> {
  const { data, error } = await supabase.rpc('business_closure_status', { p_business_id: businessId });
  return error || !data ? null : data as ClosureStatus;
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
  // No membership (PGRST116 only; other errors fail closed): CACU support may select a case it has opened.
  const supported = !data && membershipError?.code === 'PGRST116' && (await openedSupportCases(supabase)).some(c => c.business_id === businessId);
  if (!data && !supported) throw new Error('Business membership required');
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getActiveBusinessIdAction(): Promise<string> {
  const { active } = await getBusinessSelectionAction();
  if (!active) throw new Error('Select an authorized active business');
  return active.business_id;
}