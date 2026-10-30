import { ChartService } from '@/services/chart-service';

function service(rpc: jest.Mock) {
  const chart = new ChartService();
  Object.assign(chart, { getContext: jest.fn().mockResolvedValue({ supabase: { rpc }, businessId: 'business' }) });
  return chart;
}
const key = '11111111-2222-4333-8444-555555555555';

test('adoption sends the business and retry key and returns the server summary', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { version: 'NG-2026.1', mode: 'PRODUCT', accounts: 28, replayed: false }, error: null });
  await expect(service(rpc).adopt(key)).resolves.toEqual({ version: 'NG-2026.1', mode: 'PRODUCT', accounts: 28, replayed: false });
  expect(rpc).toHaveBeenCalledWith('adopt_default_chart', { p_business_id: 'business', p_request_key: key });
});

test.each([
  ['ACCESS_DENIED', 'Only Owners and Admins'], ['BOOKS_ALREADY_SET_UP', 'already set up'], ['CHART_EXISTS', 'already has accounts'],
  ['connection reset', 'Retry to check whether they were added'],
])('adoption error %s shows a reviewed message', async (message, expected) => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { message } });
  await expect(service(rpc).adopt(key)).rejects.toThrow(expected);
});

test('a malformed retry key is refused before calling the database, and read failures hide detail', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'relation onboarding_private.x does not exist' } });
  await expect(service(rpc).adopt('not-a-key')).rejects.toThrow('The request was invalid');
  expect(rpc).not.toHaveBeenCalled();
  await expect(service(rpc).get()).rejects.toThrow('The chart of accounts could not be loaded.');
});
