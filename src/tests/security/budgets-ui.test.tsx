import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningPage from '@/app/analytics/planning/page';
import BudgetVsActualPage from '@/app/analytics/budget-vs-actual/page';
import { budgetAction, comparisonAction, saveBudgetAction } from '@/app/analytics/budget-actions';
import { spread, sum, type Budget, type Comparison } from '@/lib/budgets';

jest.mock('@/app/analytics/budget-actions', () => ({ budgetAction: jest.fn(), saveBudgetAction: jest.fn(), comparisonAction: jest.fn() }));

const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
const zeros = Array(12).fill('0.00');
const empty: Budget = { fiscal_year: 2026, months, saved_at: null, accounts: [
  { id: 'sales', code: '4000', name: 'Sales of goods', type: 'OPERATING_REVENUE', kind: 'income', months: zeros, total: '0.00' },
  { id: 'diesel', code: '6200', name: 'Utilities and power', type: 'OPERATING_EXPENSE', kind: 'expense', months: zeros, total: '0.00' }] };
const f = (budget: string, actual: string, difference: string, on_track: boolean, percent: string | null = null) => ({ budget, actual, difference, percent, on_track });

beforeEach(() => jest.clearAllMocks());

test('a yearly amount spreads over twelve months to the kobo and adds back up', () => {
  expect(spread('100000')).toEqual([...Array(11).fill('8333.33'), '8333.37']);
  expect(sum(spread('100000'))).toBe('100000.00');
  expect(spread('0')).toEqual(zeros);
});

test('the owner sets a yearly amount, adjusts a month, and saves only accounts with a budget', async () => {
  (budgetAction as jest.Mock).mockResolvedValue({ success: true, data: empty });
  (saveBudgetAction as jest.Mock).mockResolvedValue({ success: true, data: { ...empty, saved_at: '2026-11-18T10:00:00Z' } });
  render(<PlanningPage />);
  const yearly = await screen.findByLabelText('Year total for Utilities and power');
  await userEvent.clear(yearly);
  await userEvent.type(yearly, '120000.5');
  expect(screen.getByText(/Spending: ₦120,000.50 for the year/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'By month' })[1]);
  const january = screen.getByLabelText(/Utilities and power in Jan/);
  await userEvent.clear(january);
  await userEvent.type(january, '20000');
  await userEvent.click(screen.getByRole('button', { name: 'Save budget' }));
  await waitFor(() => expect(saveBudgetAction).toHaveBeenCalledTimes(1));
  const [year, lines] = (saveBudgetAction as jest.Mock).mock.calls[0];
  expect(year).toBe(new Date().getFullYear());
  expect(lines).toHaveLength(1);  // sales had no budget, so it is not sent
  expect(lines[0].account_id).toBe('diesel');
  expect(lines[0].months[0]).toBe('20000');
  expect(await screen.findByText(/Budget for .* saved/)).toBeInTheDocument();
});

test('the comparison shows each account against its budget, coloured by whether it is on track', async () => {
  const report: Comparison = { month: '2026-11-01', fiscal_year: 2026, year_from: '2026-01-01', has_budget: true,
    lines: [{ account_id: 'sales', code: '4000', name: 'Sales of goods', kind: 'income', month: f('2000.00', '3000.00', '1000.00', true, '150'), year_to_date: f('22000.00', '3000.00', '-19000.00', false, '14') },
            { account_id: 'diesel', code: '6200', name: 'Utilities and power', kind: 'expense', month: f('10000.00', '15000.00', '5000.00', false, '150'), year_to_date: f('110000.00', '15000.00', '-95000.00', true, '14') }],
    totals: { income: { month: f('2000.00', '3000.00', '1000.00', true), year_to_date: f('22000.00', '3000.00', '-19000.00', false) },
              expense: { month: f('10000.00', '15000.00', '5000.00', false), year_to_date: f('110000.00', '15000.00', '-95000.00', true) },
              profit: { month: f('-8000.00', '-12000.00', '-4000.00', false), year_to_date: f('-88000.00', '-12000.00', '76000.00', true) } } };
  (comparisonAction as jest.Mock).mockResolvedValue({ success: true, data: report });
  render(<BudgetVsActualPage />);
  const overspent = await screen.findByText('+₦5,000.00 (150%)');
  expect(overspent).toHaveClass('text-destructive');
  expect(screen.getByText('+₦1,000.00 (150%)')).toHaveClass('text-emerald-700');
  await userEvent.click(screen.getByLabelText('Year to date'));
  expect(screen.getByText('−₦95,000.00 (14%)')).toHaveClass('text-emerald-700');  // spent less than planned so far
  expect(screen.getByText(/From 2026-01-01/)).toBeInTheDocument();
});

test('without a budget the comparison says how to set one', async () => {
  (comparisonAction as jest.Mock).mockResolvedValue({ success: true, data: { month: '2026-11-01', fiscal_year: 2026, year_from: '2026-01-01', has_budget: false, lines: [],
    totals: { income: { month: f('0.00', '0.00', '0.00', true), year_to_date: f('0.00', '0.00', '0.00', true) }, expense: { month: f('0.00', '0.00', '0.00', true), year_to_date: f('0.00', '0.00', '0.00', true) },
              profit: { month: f('0.00', '0.00', '0.00', true), year_to_date: f('0.00', '0.00', '0.00', true) } } } });
  render(<BudgetVsActualPage />);
  expect(await screen.findByRole('link', { name: 'Set one' })).toHaveAttribute('href', '/analytics/planning');
});
