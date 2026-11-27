import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonthClosePage from '@/app/accounting/periods/page';
import { closeMonthAction, closeYearAction, periodsAction, reopenMonthAction, reopenYearAction } from '@/app/accounting/periods/actions';
import { unanswered, type CloseStep, type PeriodOverview } from '@/lib/periods';

jest.mock('@/app/accounting/periods/actions', () => ({ periodsAction: jest.fn(), closeMonthAction: jest.fn(), reopenMonthAction: jest.fn(),
  closeYearAction: jest.fn(), reopenYearAction: jest.fn() }));

const step = (key: string, label: string, blocking: boolean, passed: boolean, detail: string | null = null): CloseStep =>
  ({ key, label, blocking, passed, detail, needs_answer: !passed && !blocking });
const checklist = [step('trial_balance', 'Trial balance balances at the end of the month', true, true),
  step('stock', 'Stock on hand at cost matches the inventory account', true, true),
  step('bank_cash', 'Bank and cash balances agree with your statements and cash count', false, false),
  step('review', 'Statements for the month reviewed by the Owner or an Admin', false, false)];
const october: PeriodOverview = { months: [{ month: '2026-10-01', status: 'open', closed_at: null }], next_to_close: '2026-10-01', latest_closed: null, checklist, history: [] };
const closed: PeriodOverview = { months: [{ month: '2026-10-01', status: 'closed', closed_at: '2026-11-17T10:00:00Z' }], next_to_close: null,
  latest_closed: '2026-10-01', checklist: [], history: [{ event: 'period_closed', month: '2026-10-01', reason: null, at: '2026-11-17T10:00:00Z' }] };

beforeEach(() => jest.clearAllMocks());

test('warnings need a tick or an explanation of at least five characters', () => {
  expect(unanswered(checklist, {}).map(s => s.key)).toEqual(['bank_cash', 'review']);
  expect(unanswered(checklist, { bank_cash: { done: true, note: '' }, review: { done: false, note: 'ok' } }).map(s => s.key)).toEqual(['review']);
  expect(unanswered(checklist, { bank_cash: { done: true, note: '' }, review: { done: false, note: 'Owner away' } })).toEqual([]);
});

test('the closer answers every warning, closes the month, and the owner can reopen it', async () => {
  (periodsAction as jest.Mock).mockResolvedValue({ success: true, data: october });
  (closeMonthAction as jest.Mock).mockResolvedValue({ success: true, data: closed });
  (reopenMonthAction as jest.Mock).mockResolvedValue({ success: true, data: october });
  render(<MonthClosePage />);
  const button = await screen.findByRole('button', { name: 'Close October 2026' });
  await userEvent.click(button);
  expect(screen.getByRole('alert')).toHaveTextContent('Tick or explain: Bank and cash balances');
  expect(closeMonthAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getAllByLabelText('Done')[0]);
  await userEvent.type(screen.getByLabelText(/Or explain: Statements/), 'Owner travelling, reviewed by phone');
  await userEvent.click(button);
  await waitFor(() => expect(closeMonthAction).toHaveBeenCalledWith('2026-10-01', {
    bank_cash: { done: true, note: '' }, review: { done: false, note: 'Owner travelling, reviewed by phone' } }));
  expect(await screen.findByText('October 2026 is closed. Nothing can be entered in it now.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reopen month' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say why the month needs reopening.');
  await userEvent.type(screen.getByLabelText('Why does it need reopening?'), 'Supplier bill arrived late');
  await userEvent.click(screen.getByRole('button', { name: 'Reopen month' }));
  await waitFor(() => expect(reopenMonthAction).toHaveBeenCalledWith('2026-10-01', 'Supplier bill arrived late'));
});

test('a month whose books do not agree cannot be closed', async () => {
  const failing = { ...october, checklist: [step('stock', 'Stock on hand at cost matches the inventory account', true, false, 'Stock on hand at cost (5,000.00) differ from the ledger (0.00)'), ...checklist.slice(2)] };
  (periodsAction as jest.Mock).mockResolvedValue({ success: true, data: failing });
  render(<MonthClosePage />);
  expect(await screen.findByText(/differ from the ledger/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close October 2026' })).toBeDisabled();
  expect(screen.getByText(/Fix the steps marked/)).toBeInTheDocument();
});

test('a refusal from the books is shown as it is', async () => {
  (periodsAction as jest.Mock).mockResolvedValue({ success: false, error: 'Start your books before closing a month.' });
  render(<MonthClosePage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Start your books before closing a month.');
});

const ready = { ...closed, years: [{ year: 2026, start: '2025-11-01', end: '2026-10-31', status: 'open' as const, ended: true, months_open: [], profit: null, closed_at: null }] };
const shut = { ...closed, years: [{ ...ready.years[0], status: 'closed' as const, profit: '1250000.00', closed_at: '2026-11-27T10:00:00Z' }] };

test('a finished year with every month closed can be closed, and the latest closed year reopened with a reason', async () => {
  (periodsAction as jest.Mock).mockResolvedValueOnce({ success: true, data: ready }).mockResolvedValueOnce({ success: true, data: shut }).mockResolvedValue({ success: true, data: ready });
  (closeYearAction as jest.Mock).mockResolvedValue({ success: true });
  (reopenYearAction as jest.Mock).mockResolvedValue({ success: true });
  render(<MonthClosePage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Close year' }));
  expect(await screen.findByText(/Closed · profit ₦1,250,000.00/)).toBeInTheDocument();
  expect(closeYearAction).toHaveBeenCalledWith(2026);
  await userEvent.click(screen.getByRole('button', { name: 'Reopen year' }));
  await userEvent.type(screen.getByLabelText('Why does the year need reopening?'), 'Auditor adjustment');
  await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(reopenYearAction).toHaveBeenCalledWith(2026, 'Auditor adjustment'));
});

test('a year with open months says so and cannot be closed', async () => {
  (periodsAction as jest.Mock).mockResolvedValue({ success: true, data: { ...ready, years: [{ ...ready.years[0], months_open: ['2026-10-01'] }] } });
  render(<MonthClosePage />);
  expect(await screen.findByText('1 month still open')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close year' })).not.toBeInTheDocument();
});
