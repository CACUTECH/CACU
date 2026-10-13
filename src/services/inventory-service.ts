import { ManagementService } from './management-service';
export class InventoryService extends ManagementService {
    async listItems(options: {
        search?: string;
        type?: 'Product' | 'Service';
        limit?: number;
        offset?: number;
        category?: string;
        status?: string;
        low_stock?: boolean;
    } = {}) {
        return this.read('catalog', { ...options, type: options.type?.toUpperCase() });
    }
    async adjustmentHistory(itemId: string, page = 0) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId) || !Number.isSafeInteger(page) || page < 0 || page > 100000) throw new Error('Invalid history request');
        const { supabase, businessId } = await this.getContext();
        if (!businessId) throw new Error('Select a business');
        const { data: item, error: itemError } = await supabase.from('catalog_items').select('id').eq('business_id', businessId).eq('id', itemId).single();
        if (itemError || !item) throw new Error('Item unavailable in this business');
        const { data, count, error } = await supabase.from('inventory_movements')
            .select('id, delta, before_quantity, after_quantity, entry_date, reason, created_at, actor_id', { count: 'exact' })
            .eq('business_id', businessId).eq('item_id', itemId)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 20, page * 20 + 19);
        if (error) throw new Error('Stock adjustment history could not be loaded');
        return { data: data ?? [], total: count ?? 0 };
    }
    async upsertItem(item: Record<string, unknown>) {
        const { id, request_key, version, type, price, quantity, status, ...details } = item;
        if (type !== undefined)
            details.item_type = String(type).toUpperCase();
        if (price !== undefined)
            details.unit_price = String(price);
        if (quantity !== undefined) {
            if (id)
                throw new Error('Use a reasoned stock adjustment');
            details.opening_quantity = quantity;
        }
        if (status !== undefined)
            details.is_active = status === 'Active';
        return this.write({ request_key: String(request_key || crypto.randomUUID()), operation: 'item.save', item_id: id ? String(id) : null,
            expected_version: version === undefined ? null : Number(version), details });
    }
    async deleteItem(id: string, version?: number, requestKey?: string) {
        if (version === undefined)
            throw new Error('Refresh the item before archiving');
        return this.write({ request_key: requestKey || crypto.randomUUID(), operation: 'item.save', item_id: id, expected_version: version, details: { is_active: false } });
    }
    async adjustStockAtomic(id: string, delta: number, reason?: string, version?: number, requestKey?: string, entryDate?: string) {
        if (!reason || version === undefined || !requestKey || !entryDate)
            throw new Error('A reason, version, date and request key are required');
        return this.write({ request_key: requestKey, operation: 'stock.adjust', item_id: id, expected_version: version, details: { delta, reason, entry_date: entryDate } });
    }
}
