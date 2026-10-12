import { BaseService } from './base-service';
import { createClient } from '@/lib/supabase/server';

export interface CreateBusinessInput {
  name: string;
  type: 'PRODUCT' | 'SERVICE' | 'HYBRID';
  sector: string;
  address: string;
  email: string;
  phone: string;
  bank_name: string;
  account_number: string;
  account_name: string;
}

export class BusinessService extends BaseService {
  async createBusiness(input: CreateBusinessInput & { requestKey: string }) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');
    const { requestKey, ...details } = input;
    const { data: business, error } = await supabase.rpc('create_business_safe', {
      p_request_key: requestKey, p_details: details,
    });
    if (error) {
      if (error.code === 'P0001' && error.message === 'User is already registered with a business') {
        throw new Error('User is already registered with a business. Select your existing business.');
      }
      throw new Error('Business setup could not be confirmed. Retry with the same details.');
    }
    if (!business || typeof business.id !== 'string' || typeof business.replayed !== 'boolean') {
      throw new Error('Business setup could not be confirmed. Retry with the same details.');
    }
    // Optional post-commit effects must never turn a committed creation into failure.
    if (!business.replayed) {
      try {
        await supabase.from('profiles').upsert({ id: user.id, email: user.email,
          full_name: user.user_metadata?.full_name || input.name });
        await supabase.from('notifications').insert({ business_id: business.id, user_id: user.id,
          title: 'Welcome to CACU', body: 'Your workspace has been created. Start by adding your catalog items.',
          event_type: 'WELCOME' });
      } catch { /* Business and owner membership are already committed. */ }
    }
    return business as { id: string; replayed: boolean };
  }

  async updateBusiness(id: string, data: Partial<CreateBusinessInput>) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId || id !== businessId) throw new Error('Unauthorized');
    if (role !== 'owner' && role !== 'admin') throw new Error('Insufficient permissions');

    const { phone, account_number, account_name, type, ...rest } = data;
    const payload: Record<string, unknown> = { ...rest };
    if (phone !== undefined) payload.phone_number = phone;
    if (account_number !== undefined) payload.bank_account_number = account_number;
    if (account_name !== undefined) payload.bank_account_name = account_name;
    if (type !== undefined) payload.business_type = type;

    const { data: updated, error } = await supabase
      .from('businesses')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  async getActiveBusiness() {
    const { businessId, supabase } = await this.getContext();
    if (!businessId) return null;

    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    return data;
  }
}
