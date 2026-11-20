import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseBusinessPage from '@/app/settings/close/page';
import { BusinessProvider } from '@/components/business-provider';
import { closeBusinessAction, closureStatusAction, reopenBusinessAction } from '@/app/settings/close/actions';
import { getBusinessSelectionAction } from '@/app/business-actions';
import { closureError, type ClosureStatus } from '@/lib/closure';

jest.mock('@/app/settings/close/actions', () => ({ closeBusinessAction: jest.fn(), closureStatusAction: jest.fn(), reopenBusinessAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getBusinessSelectionAction: jest.fn(), selectBusinessAction: jest.fn(), getTwoStepStatusAction: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/sales' }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const open: ClosureStatus = { closed: false, closed_at: null, purge_after: null, can_reopen: false, is_owner: true, staff: 3 };
const shut: ClosureStatus = { closed: true, closed_at: '2026-11-12T10:00:00Z', purge_after: '2027-02-10T10:00:00Z', can_reopen: true, is_owner: true, staff: 0 };
const selection = (closure: ClosureStatus | null) => ({ memberships: [{ business_id: 'b1', role: 'owner', businesses: { id: 'b1', name: 'Ada Provisions' } }],
  active: { business_id: 'b1', role: 'owner', businesses: { id: 'b1', name: 'Ada Provisions' } }, twoStep: null, closure });

beforeEach(() => jest.clearAllMocks());

test('database refusals read plainly', () => {
  expect(closureError('CONFIRM_NAME_MISMATCH')).toMatch('Type the business name');
  expect(closureError('REOPEN_WINDOW_ENDED')).toBe('The 90 days to reopen have passed.');
  expect(closureError('ACCESS_DENIED')).toBe('Only the business owner can do this.');
  expect(closureError(undefined)).toBe('That did not work. Try again.');
});

test('the owner closes only after typing the name and giving a reason, then can reopen', async () => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue(selection(open));
  (closureStatusAction as jest.Mock).mockResolvedValue({ success: true, data: open });
  (closeBusinessAction as jest.Mock).mockResolvedValue({ success: true, data: shut });
  (reopenBusinessAction as jest.Mock).mockResolvedValue({ success: true, data: { ...open, staff_restored: 3 } });
  render(<BusinessProvider><CloseBusinessPage /></BusinessProvider>);
  expect(await screen.findByText(/Your staff \(3\) lose access/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Why are you closing?'), 'Moving abroad');
  await userEvent.type(screen.getByLabelText(/to confirm/), 'Ada');
  await userEvent.click(screen.getByRole('button', { name: 'Close the business' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Type the business name exactly');
  expect(closeBusinessAction).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText(/to confirm/), ' provisions');
  await userEvent.click(screen.getByRole('button', { name: 'Close the business' }));
  await waitFor(() => expect(closeBusinessAction).toHaveBeenCalledWith('Ada provisions', 'Moving abroad'));
  expect(await screen.findByText(/Closed on 12 November 2026/)).toBeInTheDocument();
  expect(screen.getByText(/The business is closed. Export your data or reopen it before 10 February 2027/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reopen the business' }));
  expect(await screen.findByText(/open again. 3 staff members have their access back/)).toBeInTheDocument();
});

test('every page says a closed business is read-only, with the way out', async () => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue(selection(shut));
  render(<BusinessProvider><p>Sales today</p></BusinessProvider>);
  expect(await screen.findByText(/This business is closed, so everything is read-only/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'reopen it' })).toHaveAttribute('href', '/settings/close');
  expect(screen.getByText('Sales today')).toBeInTheDocument();
});

test('only the owner sees the close form', async () => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue(selection(null));
  (closureStatusAction as jest.Mock).mockResolvedValue({ success: true, data: { ...open, is_owner: false } });
  render(<BusinessProvider><CloseBusinessPage /></BusinessProvider>);
  expect(await screen.findByText('Only the business owner can close the business.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close the business' })).not.toBeInTheDocument();
});
