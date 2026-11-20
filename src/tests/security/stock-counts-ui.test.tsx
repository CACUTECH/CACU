import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockCountsPage from '@/app/inventory/counts/page';
import { countAction, countsAction, decideCountAction, saveCountAction, startCountAction, submitCountAction } from '@/app/inventory/counts/actions';
import { quantity, type StockCount } from '@/lib/stock-counts';

jest.mock('@/app/inventory/counts/actions', () => ({ countsAction: jest.fn(), countAction: jest.fn(), startCountAction: jest.fn(), saveCountAction: jest.fn(),
  submitCountAction: jest.fn(), decideCountAction: jest.fn() }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'count-key' });

const base = { id: 'c1', name: 'November count', location_id: null, outlet: null, started_at: '2026-11-18T09:00:00Z', submitted_at: null, submitted_by: null, decided_on: null, note: null };
const counting: StockCount = { ...base, status: 'counting', summary: { items: 2, counted: 0, differences: 0 },
  lines: [{ item_id: 'beans', name: 'Beans', expected: 3, counted: null, difference: null, posted: false }, { item_id: 'rice', name: 'Rice', expected: 10, counted: null, difference: null, posted: false }] };
const submitted: StockCount = { ...base, status: 'submitted', submitted_by: 'u1', summary: { items: 2, counted: 2, differences: 1 },
  lines: [{ item_id: 'beans', name: 'Beans', expected: 3, counted: 2, difference: -1, posted: false }, { item_id: 'rice', name: 'Rice', expected: 10, counted: 10, difference: 0, posted: false }] };

beforeEach(() => jest.clearAllMocks());

test('a typed quantity is blank, a whole number, or a mistake', () => {
  expect(quantity('')).toBeNull();
  expect(quantity(' 12 ')).toBe(12);
  expect(quantity('1.5')).toBeUndefined();
  expect(quantity('-2')).toBeUndefined();
});

test('counts are entered, saved and submitted; an empty item stays as it is', async () => {
  (countsAction as jest.Mock).mockResolvedValue({ success: true, data: [counting] });
  (countAction as jest.Mock).mockResolvedValue({ success: true, data: counting });
  (saveCountAction as jest.Mock).mockResolvedValue({ success: true, data: counting });
  (submitCountAction as jest.Mock).mockResolvedValue({ success: true, data: submitted });
  render(<StockCountsPage />);
  await userEvent.type(await screen.findByLabelText('Counted Beans'), '2.5');
  await userEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number for Beans');
  await userEvent.clear(screen.getByLabelText('Counted Beans'));
  await userEvent.type(screen.getByLabelText('Counted Beans'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
  await waitFor(() => expect(saveCountAction).toHaveBeenCalledWith('c1', [{ item_id: 'beans', counted: 2 }, { item_id: 'rice', counted: null }]));
  await waitFor(() => expect(submitCountAction).toHaveBeenCalledWith('c1'));
  expect(await screen.findByText(/Submitted. An Owner or Admin who did not submit it approves/)).toBeInTheDocument();
  expect(screen.getByText('(-1)')).toHaveClass('text-destructive');
});

test('a submitted count is approved once, or rejected with a note', async () => {
  (countsAction as jest.Mock).mockResolvedValueOnce({ success: true, data: [submitted] }).mockResolvedValue({ success: true, data: [{ ...submitted, status: 'approved', decided_on: '2026-11-18' }] });
  (countAction as jest.Mock).mockResolvedValue({ success: true, data: submitted });
  (decideCountAction as jest.Mock).mockResolvedValue({ success: true, data: { ...submitted, status: 'approved' } });
  render(<StockCountsPage />);
  expect(await screen.findByText('1 difference to post.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Approve and post' }));
  await waitFor(() => expect(decideCountAction).toHaveBeenCalledWith('c1', true, ''));
  expect(await screen.findByText(/November count · Approved on 2026-11-18/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start count' })).toBeInTheDocument();
});

test('with no open count, one can be started', async () => {
  (countsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (startCountAction as jest.Mock).mockResolvedValue({ success: true, data: counting });
  render(<StockCountsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Start count' }));
  await waitFor(() => expect(startCountAction).toHaveBeenCalledWith('count-key', expect.stringMatching(/^Count of /)));
  expect(await screen.findByLabelText('Counted Rice')).toBeInTheDocument();
});
