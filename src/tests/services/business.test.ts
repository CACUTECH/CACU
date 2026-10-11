import { BusinessService } from '@/services/business-service';
import { createClient } from '@/lib/supabase/server';
const input = { name: 'Test', type: 'HYBRID' as const, sector: 'Retail', address: 'Test', email: 'test@example.com', phone: '1', bank_name: 'Test', account_number: '123', account_name: 'Test', requestKey: '4be53d67-0ec1-4e9b-bf0a-2b2c484616d1' };
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
test('authentication errors cannot provision', async () => {
  const client = await (createClient as jest.Mock)();
  client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user' } }, error: new Error('Expired') });
  await expect(new BusinessService().createBusiness(input)).rejects.toThrow('Unauthorized');
  expect(client.rpc).not.toHaveBeenCalled();
});
test('committed business survives optional profile failure without follow-up business read', async () => {
  const client = await (createClient as jest.Mock)();
  client.rpc.mockResolvedValueOnce({ data: { id: 'business', replayed: false }, error: null });
  client.from.mockImplementationOnce(() => { throw new Error('Profile unavailable'); });
  await expect(new BusinessService().createBusiness(input)).resolves.toEqual({ id: 'business', replayed: false });
  expect(client.rpc).toHaveBeenCalledWith('create_business_safe', { p_request_key: input.requestKey, p_details: expect.not.objectContaining({ requestKey: expect.anything() }) });
  expect(client.from).not.toHaveBeenCalledWith('businesses');
});
test('replay does not duplicate optional effects', async () => {
  const client = await (createClient as jest.Mock)();
  client.rpc.mockResolvedValueOnce({ data: { id: 'business', replayed: true }, error: null });
  await new BusinessService().createBusiness(input);
  expect(client.from).not.toHaveBeenCalled();
});
test('database failure cannot fall back to direct inserts or expose provider details', async () => {
  const client = await (createClient as jest.Mock)();
  client.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'private bank information' } });
  await expect(new BusinessService().createBusiness(input)).rejects.toThrow('could not be confirmed');
  expect(client.from).not.toHaveBeenCalled();
});
