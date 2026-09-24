
import { BaseService } from './base-service';

export class CustomerService extends BaseService {
  async listCustomers() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .order('name');

    if (error) throw error;
    return data;
  }

  async upsertCustomer(customer: any) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    if (role === 'Viewer') throw new Error('Insufficient permissions');

    const payload = {
      ...customer,
      business_id: businessId,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('customers')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteCustomer(id: string) {
    const { supabase, businessId, role } = await this.getContext();
    if (role !== 'Owner' && role !== 'Admin') throw new Error('Access denied');

    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) throw error;
    return true;
  }
}
