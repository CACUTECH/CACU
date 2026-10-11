import { createBusinessAction } from '@/app/setup/actions';
import { BusinessService } from '@/services/business-service';
import { createClient } from '@/lib/supabase/server';
const input = { name: 'Test', type: 'PRODUCT' as const, sector: 'Retail', address: 'Test address', email: 'test@example.com', phone: '1', bank_name: 'Test', account_number: '1', account_name: 'Test' };
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
test.each([
  { data: [{ id: 'A' }, { id: 'B' }], error: null },
  { data: null, error: { message: 'Membership query unavailable' } },
])('setup does not provision when membership exists or lookup fails', async result => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const create = jest.spyOn(BusinessService.prototype, 'createBusiness');
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(result) };
  const client = await (createClient as jest.Mock)(); client.from.mockReturnValueOnce(query);
  await expect(createBusinessAction(input)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
  expect(query.limit).toHaveBeenCalledWith(1);
});
