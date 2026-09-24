
import { BaseService } from './base-service';

export class InventoryService extends BaseService {
  async listItems() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('catalog_items')
      .select('*')
      .eq('business_id', businessId)
      .order('name');

    if (error) throw error;
    return data;
  }

  async upsertItem(item: any) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    if (role === 'Viewer') throw new Error('Insufficient permissions');

    const data = {
      ...item,
      business_id: businessId,
    };

    const { data: result, error } = await supabase
      .from('catalog_items')
      .upsert(data)
      .select()
      .single();

    if (error) throw error;
    return result;
  }

  async deleteItem(id: string) {
    const { supabase, businessId, role } = await this.getContext();
    if (role !== 'Owner' && role !== 'Admin') throw new Error('Only admins can delete items');

    const { error } = await supabase
      .from('catalog_items')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId); // Extra safety layer

    if (error) throw error;
    return true;
  }
}
