import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import KpiPage from '@/app/analytics/kpi/page';
import { kpisAction } from '@/app/analytics/kpi/actions';
import { better, show, type Kpis } from '@/lib/kpis';

jest.mock('@/app/analytics/kpi/actions', () => ({ kpisAction: jest.fn() }));

const figure = (key: string, label: string, value: string, previous: string | null, change: string | null, good: 'up' | 'down' = 'up', kind: 'money' | 'count' | 'percent' = 'money') =>
  ({ key, label, value, previous, change, good, kind });
const data: Kpis = { period: { start_date: '2026-11-01', end_date: '2026-11-18' }, previous_period: { start_date: '2026-10-14', end_date: '2026-10-31' },
  label: 'Management statements, not reviewed', exceptions: [],
  figures: [figure('revenue', 'Revenue', '68000.00', '50000.00', '36'), figure('operating_expenses', 'Operating expenses', '20000.00', '15000.00', '33', 'down'),
            figure('sales', 'Sales and invoices', '120', '96', '25', 'up', 'count'), figure('gross_margin', 'Gross margin', '23', null, null, 'up', 'percent')],
  at_end: [{ key: 'receivables', label: 'Customers owe you', value: '125000.00', detail: '15000.00 overdue' }, { key: 'cash', label: 'Cash and bank', value: '410000.00' }] };

test('figures read in naira, counts and percentages, and changes are judged the right way round', () => {
  expect(show('68000.00')).toBe('₦68,000.00');
  expect(show('-500')).toBe('−₦500.00');
  expect(show('120', 'count')).toBe('120');
  expect(show('23', 'percent')).toBe('23%');
  expect(better(data.figures[0])).toBe(true);   // revenue up
  expect(better(data.figures[1])).toBe(false);  // spending up
  expect(better(data.figures[3])).toBeNull();
});

test('the dashboard shows each figure against the period before, and the position at the end', async () => {
  (kpisAction as jest.Mock).mockResolvedValue({ success: true, data });
  render(<KpiPage />);
  expect(await screen.findByText('₦68,000.00')).toBeInTheDocument();
  expect(screen.getByText('(+36%)')).toHaveClass('text-emerald-700');
  expect(screen.getByText('(+33%)')).toHaveClass('text-destructive');
  expect(screen.getByText('15000.00 overdue')).toBeInTheDocument();
  expect(screen.getByText('At 2026-11-18')).toBeInTheDocument();
});

test('figures from books that do not reconcile carry a warning', async () => {
  (kpisAction as jest.Mock).mockResolvedValue({ success: true, data: { ...data, exceptions: [{ check: 'trial_balance', message: 'Debits and credits differ at the end of this period' }] } });
  render(<KpiPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Debits and credits differ');
});
