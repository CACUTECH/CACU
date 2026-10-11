import { BaseService } from '@/services/base-service';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

class ContextService extends BaseService { context() { return this.getContext(); } }

function builder(data: unknown, error: unknown = null) {
  const query = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
    limit: jest.fn().mockResolvedValue({ data, error }),
  };
  return query;
}

beforeEach(() => jest.clearAllMocks());

test('revalidates selected membership against the authenticated user', async () => {
  const client = await (createClient as jest.Mock)();
  const query = builder({ business_id: 'B', role: 'viewer' });
  client.from.mockReturnValueOnce(query);
  (await cookies()).get = jest.fn().mockReturnValue({ value: 'B' });
  const context = await new ContextService().context();
  expect(context.businessId).toBe('B');
  expect(context.role).toBe('viewer');
  expect(query.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
  expect(query.eq).toHaveBeenCalledWith('business_id', 'B');
});

test('revoked membership fails instead of selecting another tenant', async () => {
  const client = await (createClient as jest.Mock)();
  client.from.mockReturnValueOnce(builder(null, { message: 'not found' }));
  await expect(new ContextService().context()).rejects.toThrow('no longer valid');
});

test('does not silently choose the first membership', async () => {
  const client = await (createClient as jest.Mock)();
  (await cookies()).get = jest.fn().mockReturnValue(undefined);
  client.from.mockReturnValueOnce(builder([{ business_id: 'A', role: 'owner' }, { business_id: 'B', role: 'viewer' }]));
  await expect(new ContextService().context()).rejects.toThrow('Select an active business');
});