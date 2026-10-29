import { HRService } from '@/services/hr-service';
import { MembershipService } from '@/services/membership-service';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

beforeEach(async () => { jest.clearAllMocks(); (await cookies()).get = jest.fn().mockReturnValue({ value: 'B' }); });
function context(role: string) { return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { business_id: 'B', role }, error: null }) }; }
test.each(['viewer', 'editor'])('%s cannot enumerate business members', async role => {
  const client = await (createClient as jest.Mock)(); client.from.mockReturnValueOnce(context(role));
  await expect(new MembershipService().listActiveBusinessMembers()).rejects.toThrow('Owner or administrator');
  expect(client.from).toHaveBeenCalledTimes(1);
});
test('owner reads only the active business and safe membership fields', async () => {
  const client = await (createClient as jest.Mock)();
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [{ user_id: 'member', role: 'viewer' }], error: null, count: 1 }) };
  client.from.mockReturnValueOnce(context('owner')).mockReturnValueOnce(query);
  expect((await new MembershipService().listActiveBusinessMembers()).total).toBe(1);
  expect(query.eq).toHaveBeenCalledWith('business_id', 'B');
  expect(query.eq).toHaveBeenCalledWith('is_active', true);
  expect(query.select).toHaveBeenCalledWith('user_id, role', { count: 'exact' });
});

test.each(['viewer', 'editor'])('%s cannot retrieve salary-bearing HR records', async role => {
  const client = await (createClient as jest.Mock)(); client.from.mockReturnValueOnce(context(role));
  await expect(new HRService().getEmployee('00000000-0000-4000-8000-000000000001')).rejects.toThrow('HR access');
  expect(client.from).toHaveBeenCalledTimes(1);
});
