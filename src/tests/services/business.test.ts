import { BusinessService } from '@/services/business-service';
import { createClient } from '@/lib/supabase/server';

describe('BusinessService', () => {
  let service: BusinessService;

  beforeEach(() => {
    service = new BusinessService();
    jest.clearAllMocks();
  });

  it('should prevent unauthorized business creation', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Auth error') });

    await expect(service.createBusiness({
      name: 'Illegal Biz',
      type: 'HYBRID',
      sector: 'IT',
      address: 'Lagos',
      email: 'test@test.com',
      phone: '123',
      bank_name: 'Test Bank',
      account_number: '123',
      account_name: 'Test'
    })).rejects.toThrow('Unauthorized');
  });

  it('should initialize membership as Owner during creation', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    const result = await service.createBusiness({
      name: 'Safe Biz',
      type: 'HYBRID',
      sector: 'IT',
      address: 'Lagos',
      email: 'test@test.com',
      phone: '123',
      bank_name: 'Test Bank',
      account_number: '123',
      account_name: 'Test'
    });

    // Check if membership insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('memberships');
  });
});