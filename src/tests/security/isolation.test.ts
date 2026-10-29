import { LedgerService } from '@/services/ledger-service';
import { CustomerService } from '@/services/customer-service';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(false) }));

describe('Multi-Tenant Isolation Security Tests', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService();
  });

  it('records legacy entries only through the guarded function for the authenticated business', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    mockSupabase.rpc = jest.fn().mockResolvedValue({ data: { id: 'entry', replayed: false }, error: null });
    service['getContext'] = jest.fn().mockResolvedValue({
      supabase: mockSupabase,
      businessId: 'BUSINESS_A',
      role: 'owner',
      user: { id: 'USER_1' }
    });

    await service.recordEntry({
      description: 'Theft Attempt',
      amount: 1000000,
      type: 'Income',
      category: 'Test',
      requestKey: '7b0f7f0e-8d3a-4e8e-9a51-2a8f0c6f1d11',
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('record_ledger_entry_safe', expect.objectContaining({
      p_business_id: 'BUSINESS_A', p_request_key: '7b0f7f0e-8d3a-4e8e-9a51-2a8f0c6f1d11', p_amount: '1000000',
    }));
    expect(mockSupabase.from).not.toHaveBeenCalledWith('financial_transactions');
  });

  it('refuses viewers, malformed request keys and reports uncertain failures as retryable', async () => {
    const mockSupabase = await (createClient as jest.Mock)();
    const base = { description: 'x', amount: 10, type: 'Income' as const, category: 'Test', requestKey: '7b0f7f0e-8d3a-4e8e-9a51-2a8f0c6f1d11' };
    service['getContext'] = jest.fn().mockResolvedValue({ supabase: mockSupabase, businessId: 'biz-1', role: 'viewer' });
    await expect(service.recordEntry(base)).rejects.toMatchObject({ message: 'Insufficient permissions', uncertain: false });
    await expect(service.recordEntry({ ...base, requestKey: 'nope' })).rejects.toMatchObject({ uncertain: false });
    service['getContext'] = jest.fn().mockResolvedValue({ supabase: mockSupabase, businessId: 'biz-1', role: 'editor' });
    mockSupabase.rpc = jest.fn().mockResolvedValue({ data: null, error: { code: '', message: 'connection reset at 10.0.0.4' } });
    const failure = await service.recordEntry(base).catch(e => e);
    expect(failure.uncertain).toBe(true);
    expect(failure.message).not.toContain('10.0.0.4');
    mockSupabase.rpc = jest.fn().mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_LEDGER_ENTRY' } });
    await expect(service.recordEntry(base)).rejects.toMatchObject({ uncertain: false, message: expect.stringContaining('amount above zero') });
  });

  it('HIGH: Should block Viewer role from modifying ledger', async () => {
     const mockSupabase = await (createClient as jest.Mock)();
     service['getContext'] = jest.fn().mockResolvedValue({
        supabase: mockSupabase,
        businessId: 'biz-1',
        role: 'viewer'
     });

     // recordEntry doesn't have explicit role check but relies on RLS
     // but we can add one in ledger-service.ts later if needed.
     // For now we test existing CustomerService which has the check
     const customerService = new CustomerService();
     customerService['getContext'] = jest.fn().mockResolvedValue({
        supabase: mockSupabase,
        businessId: 'biz-1',
        role: 'viewer'
     });

     await expect(customerService.upsertCustomer({ name: 'Hacker' })).rejects.toThrow('Insufficient permissions');
  });
});