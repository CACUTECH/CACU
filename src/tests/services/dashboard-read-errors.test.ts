import { ReportService } from '@/services/report-service';
jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(false) }));
class TestReportService extends ReportService { getContext = jest.fn(); }

function setup(inventoryError: unknown = null, jobsError: unknown = null) {
  const inv = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: inventoryError }) };
  inv.select.mockReturnValue(inv); inv.eq.mockReturnValue(inv);
  const jobs = { select: jest.fn(), eq: jest.fn(), neq: jest.fn() };
  jobs.select.mockReturnValue(jobs); jobs.eq.mockReturnValue(jobs);
  jobs.neq.mockReturnValueOnce(jobs).mockResolvedValueOnce({ count: 0, error: jobsError });
  const service = new TestReportService();
  service.getContext.mockResolvedValue({ businessId: 'authorized', supabase: { rpc: jest.fn().mockResolvedValue({ data: [{}], error: null }), from: jest.fn().mockReturnValueOnce(inv).mockReturnValueOnce(jobs) } });
  return service;
}

test('failed inventory query is not reported as a zero inventory balance', async () => {
  await expect(setup({ message: 'provider detail' }).getDashboardStats('2026-10-01', '2026-10-14')).rejects.toThrow('Inventory summary unavailable');
});
test('failed job count is not reported as zero active jobs', async () => {
  await expect(setup(null, { message: 'provider detail' }).getDashboardStats('2026-10-01', '2026-10-14')).rejects.toThrow('Job summary unavailable');
});
test('confirmed empty operational results still display honest zero counts', async () => {
  await expect(setup().getDashboardStats('2026-10-01', '2026-10-14')).resolves.toMatchObject({ jobs: { activeCount: 0 }, inventory: { total_skus: 0 } });
});
