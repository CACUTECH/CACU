
import { BaseService } from './base-service';

export class HRService extends BaseService {
  async listEmployees() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', businessId)
      .order('name');

    if (error) throw error;
    return data;
  }

  async addEmployee(employee: any) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    const { data, error } = await supabase
      .from('employees')
      .insert({
        ...employee,
        business_id: businessId
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
