import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfitabilityPage from '@/app/analytics/profitability/page';
import { profitabilityAction } from '@/app/analytics/profitability/actions';
import { naira, type Profitability } from '@/lib/profitability';

jest.mock('@/app/analytics/profitability/actions', () => ({ profitabilityAction: jest.fn() }));

const row = (name: string, revenue: string, cost: string, profit: string, margin: string | null, extra = {}) => ({ name, revenue, cost, profit, margin, ...extra });
const report: Profitability = { start_date: '2026-11-01', end_date: '2026-11-18', label: 'Management figures from your books, not reviewed',
  items: [row('Rice', '65000.00', '50000.00', '15000.00', '23', { item_id: 'rice', kind: 'product', quantity: 1 }),
          row('Haircut', '3000.00', '0.00', '3000.00', '100', { item_id: 'cut', kind: 'service', quantity: 2 }),
          row('Beans', '1000.00', '1200.50', '-200.50', '-20', { item_id: 'beans', kind: 'product', quantity: 1 })],
  outlets: [row('Ikorodu shop', '66000.00', '51200.50', '14799.50', '22'), row('Invoices and services', '3000.00', '0.00', '3000.00', '100')],
  jobs: [{ job_id: 'j1', number: 'JOB-0001', revenue: '20000.00', materials: '5000.00', labour: '4000.00', profit: '11000.00', unrated: 1 }],
  totals: row('All sales', '69000.00', '51200.50', '17799.50', '26') };

beforeEach(() => jest.clearAllMocks());

test('amounts show their sign', () => {
  expect(naira('-200.50')).toBe('−₦200.50');
  expect(naira('15000')).toBe('₦15,000.00');
});

test('profit by item, outlet and job, with losses marked', async () => {
  (profitabilityAction as jest.Mock).mockResolvedValue({ success: true, data: report });
  render(<ProfitabilityPage />);
  expect(await screen.findByText(/₦17,799.50 profit/)).toBeInTheDocument();
  expect(screen.getByText('−₦200.50')).toHaveClass('text-destructive');
  expect(screen.getByText('service')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Outlets' }));
  expect(screen.getByText('Ikorodu shop')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
  expect(screen.getByText('JOB-0001')).toBeInTheDocument();
  expect(screen.getByText('1 labour entry has no cost rate')).toBeInTheDocument();
});

test('jobs are not offered below Chairman', async () => {
  (profitabilityAction as jest.Mock).mockResolvedValue({ success: true, data: { ...report, jobs: null } });
  render(<ProfitabilityPage />);
  expect(await screen.findByRole('tab', { name: 'Outlets' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Jobs' })).not.toBeInTheDocument();
});
