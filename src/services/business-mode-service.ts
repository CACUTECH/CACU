import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseService } from './base-service';
import { canManageBusiness, isBusinessMode } from '@/lib/business-mode';

// Messages on this error are written for the browser; anything else stays server-side.
export class BusinessModeError extends Error {}

export async function readBusinessMode(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase.from('businesses').select('business_type').eq('id', businessId).single();
  if (error || !data || !isBusinessMode(data.business_type)) throw new BusinessModeError('Business mode unavailable. Refresh and retry.');
  return data.business_type;
}

export class BusinessModeService extends BaseService {
  async read() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new BusinessModeError('Select an active business.');
    return readBusinessMode(supabase, businessId);
  }

  async update(input: { businessId: string; expectedMode: string; mode: string }) {
    if (!input || typeof input.businessId !== 'string' || !isBusinessMode(input.mode) || !isBusinessMode(input.expectedMode)) {
      throw new BusinessModeError('Choose a valid business mode.');
    }
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId || input.businessId !== businessId || !canManageBusiness(role)) {
      throw new BusinessModeError('An active Owner or Admin must change this business mode.');
    }
    const current = await readBusinessMode(supabase, businessId);
    // Retrying a confirmed database write after a lost response is harmless.
    if (current === input.mode) return current;
    if (current !== input.expectedMode) throw new BusinessModeError('Business mode changed elsewhere. Refresh before saving again.');
    const { data, error } = await supabase.from('businesses').update({ business_type: input.mode })
      .eq('id', businessId).eq('business_type', input.expectedMode).select('business_type').maybeSingle();
    if (error) throw new BusinessModeError('Business mode could not be saved. Refresh to check its current value.');
    // No returned row means a concurrent change or a denied write; either way nothing was saved.
    if (!data || data.business_type !== input.mode) throw new BusinessModeError('Business mode was not saved. Refresh to check the current mode and your access.');
    return input.mode;
  }
}
