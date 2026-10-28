import { HRService } from '@/services/hr-service';
class TestHRService extends HRService { getContext = jest.fn(); }
function setup(role: string | null = 'owner', businessId: string | null = 'authorized-business', error: unknown = null, count: number | null = 21) {
  const query = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), range: jest.fn().mockResolvedValue({ data: [{ id: 'employee' }], count, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = jest.fn().mockReturnValue(query);
  const service = new TestHRService();
  service.getContext.mockResolvedValue({ supabase: { from }, businessId, role });
  return { service, from, query };
}
test.each(['owner', 'admin'])('%s gets a bounded tenant-scoped directory without salary or bank projections', async role => {
  const { service, query } = setup(role);
  await expect(service.listEmployeeDirectory(1)).resolves.toEqual({ data: [{ id: 'employee' }], total: 21 });
  expect(query.select).toHaveBeenCalledWith('id,full_name,job_title,department,employment_status', { count: 'exact' });
  expect(query.eq).toHaveBeenCalledWith('business_id', 'authorized-business');
  expect(query.range).toHaveBeenCalledWith(20, 39);
  expect(query.order.mock.calls).toEqual([['full_name', { ascending: true }], ['id', { ascending: true }]]);
});
test.each(['editor','viewer',null,'superuser'])('denies %s before employee access', async role => {
  const { service, from } = setup(role);
  await expect(service.listEmployeeDirectory()).rejects.toThrow('HR access is restricted');
  expect(from).not.toHaveBeenCalled();
});
test('missing active business fails closed', async () => {
  const { service, from } = setup('owner', null);
  await expect(service.listEmployeeDirectory()).rejects.toThrow('HR access is restricted');
  expect(from).not.toHaveBeenCalled();
});
test.each([-1, 0.5, NaN, Infinity, 100001])('invalid page %s cannot access context', async page => {
  const { service } = setup();
  await expect(service.listEmployeeDirectory(page)).rejects.toThrow('Invalid employee page');
  expect(service.getContext).not.toHaveBeenCalled();
});
test.each([[{ message: 'private database information' },21],[null,null]])('failed or incomplete reads are not empty results', async (error, count) => {
  const { service } = setup('owner','authorized-business',error,count);
  await expect(service.listEmployeeDirectory()).rejects.toThrow('Employee records unavailable');
});
test('missing response rows fail closed instead of displaying an empty directory', async () => {
  const { service, query } = setup();
  query.range.mockResolvedValue({ data: null, count: 21, error: null });
  await expect(service.listEmployeeDirectory()).rejects.toThrow('Employee records unavailable');
});
