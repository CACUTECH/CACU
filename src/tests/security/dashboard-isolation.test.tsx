import { act, render, screen } from '@testing-library/react';
import DashboardPage from '@/app/page';
import { getDashboardStatsAction, getRevenueTrendAction } from '@/app/reports/actions';
jest.mock('lucide-react', () => Object.fromEntries(['TrendingUp','Clock','Wrench','Package','Activity','TrendingDown','Receipt','PlusCircle','MonitorSpeaker','ArrowLeftRight','Users','Calendar','Loader2','ChevronDown','ChevronUp','Check'].map(name => [name, () => null])));
let mockBusiness = { id: 'A', name: 'Business A', business_type: 'Product' };
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: mockBusiness, loading: false }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/data-chart', () => ({ DataChart: () => <div>Saved chart</div> }));
jest.mock('@/app/reports/actions', () => ({ getDashboardStatsAction: jest.fn(), getRevenueTrendAction: jest.fn() }));
beforeEach(() => {
  mockBusiness = { id: 'A', name: 'Business A', business_type: 'Product' };
  (getDashboardStatsAction as jest.Mock).mockReset();
  (getRevenueTrendAction as jest.Mock).mockReset();
});
function result(amount: number) { return { success: true, data: { financials: { total_income: amount }, inventory: {}, jobs: {} } }; }

test('late financial response for a prior business cannot replace the current dashboard', async () => {
  let first!: (value: unknown) => void;
  (getDashboardStatsAction as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValueOnce(result(2002));
  (getRevenueTrendAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  const { rerender } = render(<DashboardPage />);
  mockBusiness = { id: 'B', name: 'Business B', business_type: 'Product' };
  await act(async () => { rerender(<DashboardPage />); });
  expect(screen.getByText('₦2,002')).toBeInTheDocument();
  await act(async () => { first(result(1001)); });
  expect(screen.queryByText('₦1,001')).not.toBeInTheDocument();
  expect(screen.getByText('₦2,002')).toBeInTheDocument();
});

test('failed new-business load removes earlier financial figures and exposes recovery', async () => {
  (getDashboardStatsAction as jest.Mock).mockResolvedValueOnce(result(1001)).mockRejectedValueOnce(new Error('Interrupted response'));
  (getRevenueTrendAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  let rendered!: ReturnType<typeof render>;
  await act(async () => { rendered = render(<DashboardPage />); });
  expect(screen.getByText('₦1,001')).toBeInTheDocument();
  mockBusiness = { id: 'B', name: 'Business B', business_type: 'Product' };
  await act(async () => { rendered.rerender(<DashboardPage />); });
  expect(screen.queryByText('₦1,001')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Dashboard unavailable');
  expect(screen.getByRole('button', { name: /^Retry$/ })).toBeInTheDocument();
});
