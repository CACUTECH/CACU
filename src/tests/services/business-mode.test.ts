import { isBusinessMode, isRouteAvailableInMode, canManageBusiness } from '@/lib/business-mode';
import { BusinessModeError, BusinessModeService } from '@/services/business-mode-service';
class TestModeService extends BusinessModeService { getContext = jest.fn(); }
function setup({ role = 'owner' as string | null, businessId = 'active-business' as string | null, current = 'PRODUCT' as unknown,
  readError = null as unknown, updated = { business_type: 'HYBRID' } as unknown, updateError = null as unknown } = {}) {
  const read = { select: jest.fn(), eq: jest.fn(), single: jest.fn().mockResolvedValue({ data: current === null ? null : { business_type: current }, error: readError }) };
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  const write = { update: jest.fn(), eq: jest.fn(), select: jest.fn(), maybeSingle: jest.fn().mockResolvedValue({ data: updated, error: updateError }) };
  write.update.mockReturnValue(write); write.eq.mockReturnValue(write); write.select.mockReturnValue(write);
  const from = jest.fn().mockReturnValueOnce({ select: read.select }).mockReturnValueOnce({ update: write.update });
  const service = new TestModeService();
  service.getContext.mockResolvedValue({ supabase: { from }, businessId, role });
  return { service, from, read, write };
}
const change = { businessId: 'active-business', expectedMode: 'PRODUCT', mode: 'HYBRID' };

test.each([['/pos', 'PRODUCT', true], ['/pos/receipt', 'HYBRID', true], ['/pos', 'SERVICE', false], ['/jobs', 'PRODUCT', false],
  ['/appointments/new', 'SERVICE', true], ['/jobs', 'HYBRID', true], ['/position', 'SERVICE', true], ['/invoices', 'SERVICE', true],
  ['/pos', undefined, false], ['/jobs', 'unknown', false]])('route %s in %s mode available: %s', (path, mode, expected) => {
  expect(isRouteAvailableInMode(path, mode)).toBe(expected);
});
test('mode and manager checks accept only known values', () => {
  expect(['PRODUCT', 'SERVICE', 'HYBRID'].every(isBusinessMode)).toBe(true);
  expect([undefined, 'product', 'RETAIL', 1].some(isBusinessMode)).toBe(false);
  expect(['owner', 'admin'].every(canManageBusiness)).toBe(true);
  expect(['editor', 'viewer', 'Owner', null].some(canManageBusiness)).toBe(false);
});
test.each(['owner', 'admin'])('%s saves a mode with a compare-and-set on the active business', async role => {
  const { service, write } = setup({ role });
  await expect(service.update(change)).resolves.toBe('HYBRID');
  expect(write.update).toHaveBeenCalledWith({ business_type: 'HYBRID' });
  expect(write.eq.mock.calls).toEqual([['id', 'active-business'], ['business_type', 'PRODUCT']]);
});
test.each(['editor', 'viewer', null])('%s cannot change the mode or reach the database', async role => {
  const { service, from } = setup({ role });
  await expect(service.update(change)).rejects.toThrow('An active Owner or Admin must change this business mode.');
  expect(from).not.toHaveBeenCalled();
});
test('a different business than the active membership is refused', async () => {
  const { service, from } = setup();
  await expect(service.update({ ...change, businessId: 'other-business' })).rejects.toThrow(BusinessModeError);
  expect(from).not.toHaveBeenCalled();
});
test.each([{ ...change, mode: 'RETAIL' }, { ...change, expectedMode: '' }, null])('invalid input %p never loads context', async input => {
  const { service } = setup();
  await expect(service.update(input as never)).rejects.toThrow('Choose a valid business mode.');
  expect(service.getContext).not.toHaveBeenCalled();
});
test('retry after a lost response returns the saved mode without writing again', async () => {
  const { service, from } = setup({ current: 'HYBRID' });
  await expect(service.update(change)).resolves.toBe('HYBRID');
  expect(from).toHaveBeenCalledTimes(1);
});
test('a mode changed elsewhere is not overwritten', async () => {
  const { service, from } = setup({ current: 'SERVICE' });
  await expect(service.update(change)).rejects.toThrow('Business mode changed elsewhere');
  expect(from).toHaveBeenCalledTimes(1);
});
test.each([[{ message: 'private database detail' }, null, 'could not be saved'], [null, null, 'was not saved']])(
  'failed or empty writes are reported as unsaved', async (updateError, updated, message) => {
  const { service } = setup({ updateError, updated });
  const failure = service.update(change);
  await expect(failure).rejects.toThrow(message);
  await expect(failure).rejects.not.toThrow('private database detail');
});
test.each([[{ message: 'private' }, 'PRODUCT'], [null, 'RETAIL'], [null, null]])('unreadable mode fails closed', async (readError, current) => {
  const { service } = setup({ readError, current });
  await expect(service.read()).rejects.toThrow('Business mode unavailable');
});
test('reading without an active business fails closed', async () => {
  const { service, from } = setup({ businessId: null });
  await expect(service.read()).rejects.toThrow('Select an active business.');
  expect(from).not.toHaveBeenCalled();
});
