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
