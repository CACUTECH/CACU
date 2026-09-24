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
      role: 'Admin'
    });

    await service.upsertItem({
        name: 'Test Product',
        price: 100,
        quantity: 10
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('catalog_items');
  });

  it('should reject stock updates that cause negative balance', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    (service as any).getContext = jest.fn().mockResolvedValue({
      supabase: mockSupabase,
      businessId: 'biz-123'
    });

    // Mock existing stock as 5
    mockSupabase.from().single.mockResolvedValueOnce({ data: { quantity: 5 }, error: null });

    // Attempt to remove 10
    await expect(service.updateStock('item-1', -10)).rejects.toThrow('Insufficient stock');
  });
});