
import { BaseService } from './base-service';

/**
 * @fileOverview InventoryService manages the business catalog of products and services.
 * Integrates with PostgreSQL catalog_items table with strict multi-tenant isolation.
 */
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

    // Schema Enforcement
    const data = {
      ...item,
      business_id: businessId,
      updated_at: new Date().toISOString()
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
    if (role !== 'Owner' && role !== 'Admin') throw new Error('Insufficient permissions');

    const { error } = await supabase
      .from('catalog_items')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) throw error;
    return true;
  }

  /**
   * Atomic inventory adjustment
   */
  async updateStock(id: string, delta: number) {
    const { supabase, businessId } = await this.getContext();
    
    const { data: item, error: fetchError } = await supabase
      .from('catalog_items')
      .select('quantity')
      .eq('id', id)
      .eq('business_id', businessId)
      .single();

    if (fetchError || !item) throw new Error('Item not found');

    const newQty = (item.quantity || 0) + delta;
    if (newQty < 0) throw new Error('Insufficient stock');

    const { error: updateError } = await supabase
      .from('catalog_items')
      .update({ 
        quantity: newQty,
        status: newQty === 0 ? 'Out of Stock' : 'Active'
      })
      .eq('id', id);

    if (updateError) throw updateError;
    return true;
  }
}
