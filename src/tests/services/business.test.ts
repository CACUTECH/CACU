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

  it('should create the business and profile (owner membership is handled by a DB trigger, not application code)', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    await service.createBusiness({
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

    expect(mockSupabase.from).toHaveBeenCalledWith('businesses');
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
  });
});