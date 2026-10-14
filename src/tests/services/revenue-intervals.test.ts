import { ReportService } from '@/services/report-service';
import { getAccountingSummary } from '@/lib/accounting-client';
jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(true), getAccountingSummary: jest.fn() }));
class TestReportService extends ReportService { getContext = jest.fn().mockResolvedValue({ businessId: 'authorized' }); }
beforeEach(() => { jest.clearAllMocks(); (getAccountingSummary as jest.Mock).mockResolvedValue({ revenue_trend: [
  { period: '2026-01-05', income: '1.00' }, { period: '2026-01-07', income: '2.00' },
  { period: '2026-01-11', income: '3.00' }, { period: '2026-01-12', income: '4.00' },
] }); });
test('native weekly revenue groups Monday through Sunday into one period', async () => {
  await expect(new TestReportService().getRevenueTrend('2026-01-01', '2026-01-31', 'week')).resolves.toEqual([{ period: '2026-01-05', income: 6 }, { period: '2026-01-12', income: 4 }]);
});
test('native monthly grouping retains the reported income total', async () => {
  await expect(new TestReportService().getRevenueTrend('2026-01-01', '2026-01-31', 'month')).resolves.toEqual([{ period: '2026-01', income: 10 }]);
});
test('unsupported interval is rejected before invoking the accounting service', async () => {
  await expect(new TestReportService().getRevenueTrend('2026-01-01', '2026-01-31', 'quarter' as 'day')).rejects.toThrow('Invalid revenue interval');
  expect(getAccountingSummary).not.toHaveBeenCalled();
});
