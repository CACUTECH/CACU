import { SalesService } from '@/services/sales-service';
import { createClient } from '@/lib/supabase/server';

describe('Financial Integrity Tests', () => {
  let service: SalesService;

  beforeEach(() => {
    service = new SalesService();
  });

  it('should use atomic process_sale RPC for checkouts', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    (service as any).getContext = jest.fn().mockResolvedValue({
        supabase: mockSupabase,
        businessId: 'biz-123'
    });

    await service.processCheckout({
        items: [{ id: '1', name: 'Item', quantity: 1, price: 10 }],
        paymentMethod: 'Cash',
        totalAmount: 10
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('process_sale', expect.any(Object));
  });

  it('should trigger low stock notifications after valid checkout', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    (service as any).getContext = jest.fn().mockResolvedValue({
        supabase: mockSupabase,
        businessId: 'biz-123'
    });

    // Mock stock level falling below threshold. checkInventoryThresholds
    // constructs its own NotificationService internally, which resolves its
    // *real* (unmocked) getContext() — that does a second `.single()` call
    // against `memberships`, so it needs its own queued response too.
    mockSupabase.from().single
        .mockResolvedValueOnce({
            data: { name: 'Running Low', stock_quantity: 2, reorder_level: 5 },
            error: null
        })
        .mockResolvedValueOnce({
            data: { business_id: 'biz-123', role: 'owner' },
            error: null
        });

    // Note: private method testing requires casting or public trigger
    await (service as any).checkInventoryThresholds([{ id: '1' }]);
    
    // Verify notification insert was attempted
    expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
  });
});