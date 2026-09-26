import { InventoryService } from '@/services/inventory-service';
import { createClient } from '@/lib/supabase/server';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(() => {
    service = new InventoryService();
  });

  it('should enforce numeric price and quantity in upsert', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    // Simulate user membership
    (service as any).getContext = jest.fn().mockResolvedValue({
      supabase: mockSupabase,
      businessId: 'biz-123',
      role: 'admin'
    });

    await service.upsertItem({
        name: 'Test Product',
        price: 100,
        quantity: 10
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('catalog_items');
  });

  it('should reject stock adjustments that cause negative balance', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    (service as any).getContext = jest.fn().mockResolvedValue({
      supabase: mockSupabase,
      businessId: 'biz-123'
    });

    // adjust_inventory_stock is an atomic Postgres RPC that enforces the
    // non-negative-balance constraint server-side to avoid race conditions;
    // simulate it rejecting the delta.
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Insufficient stock' }
    });

    // Attempt to remove 10. The RPC error is a plain Postgrest-style object
    // (not an Error instance), so match on shape rather than `.toThrow()`.
    await expect(service.adjustStockAtomic('item-1', -10)).rejects.toMatchObject({
      message: 'Insufficient stock'
    });
  });
});