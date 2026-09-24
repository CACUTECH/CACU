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
  async createBusiness(input: CreateBusinessInput) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({
        name: input.name,
        business_type: input.type,
        sector: input.sector,
        address: input.address,
        email: input.email,
        phone: input.phone,
        bank_name: input.bank_name,
        account_number: input.account_number,
        account_name: input.account_name,
        owner_uid: user.id
      })
      .select()
      .single();

    if (bizError) throw new Error(`Business Provisioning Failed: ${bizError.message}`);

    await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name || input.name,
    });

    const { error: memberError } = await supabase
      .from('business_members')
      .insert({
        business_id: business.id,
        user_id: user.id,
        role: 'Owner',
      });

    if (memberError) throw new Error(`Membership Initialization Failed: ${memberError.message}`);

    // Welcome Notification via direct insert to bypass Service lifecycle for first-run
    await supabase.from('notifications').insert({
      business_id: business.id,
      user_id: user.id,
      title: 'Welcome to CACU',
      message: 'Your production workspace has been launched. Start by adding your team or catalog items.',
      type: 'WELCOME'
    });

    return business;
  }

  async updateBusiness(id: string, data: Partial<CreateBusinessInput>) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId || id !== businessId) throw new Error('Unauthorized');
    if (role !== 'Owner' && role !== 'Admin') throw new Error('Insufficient permissions');

    const { data: updated, error } = await supabase
      .from('businesses')
      .update(data)
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
