import { HRError, HRService } from '@/services/hr-service';
import { mutateHRAction } from '@/app/hr/actions';
import { hrErrorMessage, isIsoDate, lagosToday, periodLabel, type HRMutation } from '@/lib/hr';
import { revalidatePath } from 'next/cache';
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

class TestHRService extends HRService { getContext = jest.fn(); }
const KEY = '7b0f7f0e-8d3a-4e8e-9a51-2a8f0c6f1d11', EMPLOYEE = '3c1e6c55-6c0a-4a7f-8a2b-0f4c9d1e2b33';
function setup(role: string | null = 'owner', result: { data?: unknown; error?: unknown } = { data: { id: EMPLOYEE, replayed: false } }) {
  const rpc = jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  const service = new TestHRService();
  service.getContext.mockResolvedValue({ supabase: { rpc, from: jest.fn() }, businessId: 'active-business', role });
  return { service, rpc };
}
const input = (overrides: Partial<HRMutation> = {}): HRMutation =>
  ({ request_key: KEY, operation: 'employee.save', record_id: EMPLOYEE, expected_version: 3, details: { full_name: 'Ada' }, ...overrides });

test.each(['owner', 'admin'])('%s writes through hr_write on the active business', async role => {
  const { service, rpc } = setup(role);
  await expect(service.write(input())).resolves.toEqual({ id: EMPLOYEE, replayed: false });
  expect(rpc).toHaveBeenCalledWith('hr_write', { p_business_id: 'active-business', p_request_key: KEY, p_operation: 'employee.save',
    p_id: EMPLOYEE, p_version: 3, p_data: { full_name: 'Ada' } });
});
test.each(['editor', 'viewer', null])('%s is refused before the database', async role => {
  const { service, rpc } = setup(role);
  await expect(service.write(input())).rejects.toThrow('HR access is restricted');
  expect(rpc).not.toHaveBeenCalled();
});
test.each([{ request_key: 'not-a-key' }, { operation: 'employee.delete' as never }, { record_id: '1; drop' }, { expected_version: 1.5 }, { details: null as never }])(
  'malformed request %p never loads context', async overrides => {
    const { service } = setup();
    await expect(service.write(input(overrides))).rejects.toThrow('The HR request was invalid');
    expect(service.getContext).not.toHaveBeenCalled();
  });
test('database validation errors are definite and mapped to reviewed messages', async () => {
  const { service } = setup('owner', { error: { code: 'P0001', message: 'VERSION_CONFLICT' } });
  const failure = service.write(input());
  await expect(failure).rejects.toMatchObject({ uncertain: false, message: expect.stringContaining('changed elsewhere') });
});
test('transport failures are uncertain and hide private details', async () => {
  const { service } = setup('owner', { error: { code: '', message: 'connection reset at 10.0.0.4' } });
  const error = await service.write(input()).catch(e => e);
  expect(error).toBeInstanceOf(HRError);
  expect(error.uncertain).toBe(true);
  expect(error.message).not.toContain('10.0.0.4');
});
test('an empty response is not treated as saved', async () => {
  const { service } = setup('owner', { data: null });
  await expect(service.write(input())).rejects.toMatchObject({ uncertain: true });
});
test('unknown database messages fall back to a generic message', () => {
  expect(hrErrorMessage('UNSUPPORTED_FIELD: monthly_salary')).toContain('cannot be changed');
  expect(hrErrorMessage('duplicate key value violates "hr_secret_index"')).not.toContain('hr_secret_index');
  expect(hrErrorMessage(undefined)).toContain('could not be saved');
});
test.each([['2026-02-28', true], ['2026-02-30', false], ['2026-2-1', false], [20260101, false]])('date %p valid: %p', (value, expected) => {
  expect(isIsoDate(value)).toBe(expected);
});
test('business dates use Lagos time and month labels are stable', () => {
  expect(lagosToday(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29');
  expect(periodLabel('2026-01-01')).toBe('January 2026');
});
test('reads of a malformed employee id never reach the database', async () => {
  const { service } = setup();
  await expect(service.getEmployee('../../etc')).resolves.toBeNull();
  await expect(service.history('x')).resolves.toEqual([]);
  expect(service.getContext).not.toHaveBeenCalled();
});

describe('mutateHRAction', () => {
  const write = jest.spyOn(HRService.prototype, 'write');
  afterAll(() => write.mockRestore());
  beforeEach(() => jest.clearAllMocks());
  test('confirmed change revalidates HR pages', async () => {
    write.mockResolvedValue({ id: EMPLOYEE });
    await expect(mutateHRAction(input())).resolves.toEqual({ success: true, data: { id: EMPLOYEE } });
    expect(revalidatePath).toHaveBeenCalledWith('/hr', 'layout');
  });
  test('reviewed errors keep their certainty', async () => {
    write.mockRejectedValue(new HRError('Only active employees can check in.', false));
    await expect(mutateHRAction(input())).resolves.toEqual({ success: false, error: 'Only active employees can check in.', uncertain: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  test('unexpected errors are uncertain and generic', async () => {
    write.mockRejectedValue(new Error('session secret'));
    const result = await mutateHRAction(input());
    expect(result).toMatchObject({ success: false, uncertain: true });
    expect(JSON.stringify(result)).not.toContain('session secret');
  });
});
