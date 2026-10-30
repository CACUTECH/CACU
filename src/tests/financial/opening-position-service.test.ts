import { OpeningPositionError, OpeningPositionService } from '@/services/opening-position-service';

function service(rpc: jest.Mock) {
  const s = new OpeningPositionService();
  Object.assign(s, { getContext: jest.fn().mockResolvedValue({ supabase: { rpc }, businessId: 'business' }) });
  return s;
}
const key = '11111111-2222-4333-8444-555555555555';
const answers = { as_of: '2026-10-01', cash: '25000', banks: [], customers: [], suppliers: [], loans: '', capital: '', notes: '' };

test('save sends the version being edited and the answers; the server computes totals', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { position: { version: 2 } }, error: null });
  await service(rpc).save(key, 1, answers);
  expect(rpc).toHaveBeenCalledWith('save_opening_position', { p_business_id: 'business', p_request_key: key, p_version: 1, p_answers: answers });
});

test('approval names the exact version reviewed', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: {}, error: null });
  await service(rpc).approve(3, '');
  expect(rpc).toHaveBeenCalledWith('approve_opening_position', { p_business_id: 'business', p_version: 3, p_note: null });
});

test.each([
  ['VERSION_CONFLICT', 'Someone else changed', false], ['CHART_REQUIRED', 'standard accounts first', false],
  ['INVALID_OPENING_POSITION', 'no negatives', false], ['connection reset by peer', 'Retry to check whether it was saved', true],
])('%s is reported with a reviewed message', async (message, expected, uncertain) => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { message } });
  const error = await service(rpc).save(key, 0, answers).catch(e => e);
  expect(error).toBeInstanceOf(OpeningPositionError);
  expect(error.message).toContain(expected);
  expect(error.uncertain).toBe(uncertain);
});

test('a malformed request key is refused before calling the database', async () => {
  const rpc = jest.fn();
  await expect(service(rpc).save('retry', 0, answers)).rejects.toThrow('The request was invalid');
  expect(rpc).not.toHaveBeenCalled();
});
