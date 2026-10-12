import { InventoryService } from '@/services/inventory-service';
import { createClient } from '@/lib/supabase/server';
jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(false), accountingRequest: jest.fn() }));
const key = '11111111-1111-4111-8111-111111111111';
let service: InventoryService, client: {
    rpc: jest.Mock;
    from: jest.Mock;
};
beforeEach(async () => { jest.clearAllMocks(); service = new InventoryService(); client = await (createClient as jest.Mock)(); (service as unknown as {
    getContext: jest.Mock;
}).getContext = jest.fn().mockResolvedValue({ supabase: client, businessId: 'B', role: 'admin' }); });
test('catalog save delegates opening quantity and exact price to the scoped mutation', async () => {
    client.rpc.mockResolvedValueOnce({ data: { id: 'item' }, error: null });
    await service.upsertItem({ name: 'Product', price: '100.50', quantity: 10, request_key: key, type: 'Product' });
    expect(client.rpc).toHaveBeenCalledWith('management_write', expect.objectContaining({ p_business_id: 'B', p_request_key: key, p_operation: 'item.save', p_data: expect.objectContaining({ unit_price: '100.50', opening_quantity: 10, item_type: 'PRODUCT' }) }));
    expect(client.from).not.toHaveBeenCalled();
});
test('existing item quantity edits are refused before writing', async () => {
    await expect(service.upsertItem({ id: 'item', quantity: 10, request_key: key })).rejects.toThrow('stock adjustment');
    expect(client.rpc).not.toHaveBeenCalled();
});
test('stock adjustments require a reason, date, version and stable key', async () => {
    await expect(service.adjustStockAtomic('item', -10)).rejects.toThrow('reason, version, date and request key');
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Insufficient stock' } });
    await expect(service.adjustStockAtomic('item', -10, 'Damaged', 2, key, '2026-10-12')).rejects.toThrow('Insufficient stock');
    expect(client.rpc).toHaveBeenCalledWith('management_write', expect.objectContaining({ p_version: 2, p_request_key: key, p_operation: 'stock.adjust' }));
});
test('archive preserves the item instead of issuing delete', async () => {
    client.rpc.mockResolvedValueOnce({ data: { id: 'item' }, error: null });
    await service.deleteItem('item', 2, key);
    expect(client.rpc).toHaveBeenCalledWith('management_write', expect.objectContaining({ p_id: 'item', p_version: 2, p_data: { is_active: false } }));
    expect(client.from).not.toHaveBeenCalled();
});
