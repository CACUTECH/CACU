
import { BaseService } from './base-service';

/**
 * @fileOverview SupplierService handles procurement and vendor relations.
 * Enforces business context and role-based access for supply chain data.
 */
export class SupplierService extends BaseService {
  async listSuppliers() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('business_id', businessId)
      .order('name');

    if (error) throw error;
    return data;
  }

  async upsertSupplier(supplier: any) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    if (role === 'viewer') throw new Error('Insufficient permissions');

    const payload = {
      ...supplier,
      business_id: businessId,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('suppliers')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteSupplier(id: string) {
    const { supabase, businessId, role } = await this.getContext();
    if (role !== 'owner' && role !== 'admin') throw new Error('Access denied');

    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) throw error;
    return true;
  }
}
