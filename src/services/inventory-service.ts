
import { BaseService } from './base-service';

/**
 * @fileOverview InventoryService manages the business catalog.
 * Optimized with server-side search and pagination for million-row scale.
 */
export class InventoryService extends BaseService {
  
  async listItems(options: { 
    search?: string; 
    type?: 'Product' | 'Service'; 
    limit?: number; 
    offset?: number;
  } = {}) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return { data: [], total: 0 };

    const { limit = 20, offset = 0, search, type } = options;

    let query = supabase
      .from('catalog_items')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .order('name');

    if (type) {
      query = query.eq('item_type', type);
    }

    if (search) {
      // Leverages pg_trgm index for fast fuzzy matching
      query = query.ilike('name', `%${search}%`);
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);

    if (error) throw error;
    return { data: data || [], total: count || 0 };
  }

  async upsertItem(item: any) {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    if (role === 'viewer') throw new Error('Insufficient permissions');

    const { type, price, quantity, status, ...rest } = item;
    const data: Record<string, unknown> = {
      ...rest,
      business_id: businessId,
      updated_at: new Date().toISOString()
    };
    if (type !== undefined) data.item_type = type;
    if (price !== undefined) data.unit_price = price;
    if (quantity !== undefined) data.stock_quantity = quantity;
    if (status !== undefined) data.is_active = status === 'Active';

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
    if (role !== 'owner' && role !== 'admin') throw new Error('Insufficient permissions');

    const { error } = await supabase
      .from('catalog_items')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) throw error;
    return true;
  }

  async adjustStockAtomic(id: string, delta: number) {
    const { supabase, businessId } = await this.getContext();
    // Uses PostgreSQL atomic increment/decrement to prevent race conditions
    const { error } = await supabase.rpc('adjust_inventory_stock', {
      p_item_id: id,
      p_business_id: businessId,
      p_delta: delta
    });
    if (error) throw error;
    return true;
  }
}
