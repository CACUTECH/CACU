import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SupportAccessPage from '@/app/settings/support/page';
import SupportCasesPage from '@/app/support/page';
import { BusinessProvider } from '@/components/business-provider';
import { endSupportAction, grantSupportAction, supportStatusAction } from '@/app/settings/support/actions';
import { openSupportCaseAction, supportCasesAction } from '@/app/support/actions';
import { getBusinessSelectionAction } from '@/app/business-actions';
import { openedSupportCases, supportError, type SupportStatus } from '@/lib/support-access';

jest.mock('@/app/settings/support/actions', () => ({ supportStatusAction: jest.fn(), grantSupportAction: jest.fn(), endSupportAction: jest.fn() }));
jest.mock('@/app/support/actions', () => ({ supportCasesAction: jest.fn(), openSupportCaseAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getBusinessSelectionAction: jest.fn(), selectBusinessAction: jest.fn(), getTwoStepStatusAction: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/sales' }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const none: SupportStatus = { active: null, history: [] };
const granted: SupportStatus = {
  active: { id: 'g1', reason: 'Stock count looks wrong', include_pay: false, granted_at: '2026-11-13T09:00:00Z', expires_at: '2026-11-14T09:00:00Z' },
  history: [{ event: 'opened', at: '2026-11-13T10:00:00Z', reason: 'Stock count looks wrong', include_pay: false, expires_at: '2026-11-14T09:00:00Z', by: 'Tolu (CACU support)' },
    { event: 'granted', at: '2026-11-13T09:00:00Z', reason: 'Stock count looks wrong', include_pay: false, expires_at: '2026-11-14T09:00:00Z', by: 'Owner' }],
};

beforeEach(() => jest.clearAllMocks());

test('database refusals read plainly', () => {
  expect(supportError('SUPPORT_ALREADY_GRANTED')).toBe('Support already has access. End it first to grant it again.');
  expect(supportError('SUPPORT_READ_ONLY')).toBe('CACU support access is read-only.');
  expect(supportError('ACCESS_DENIED')).toBe('Only the business owner can do this.');
  expect(supportError(undefined)).toBe('That did not work. Try again.');
});

test('the owner grants access for a set time, sees who opened it, and ends it', async () => {
  (supportStatusAction as jest.Mock).mockResolvedValue({ success: true, data: none });
  (grantSupportAction as jest.Mock).mockResolvedValue({ success: true, data: granted });
  (endSupportAction as jest.Mock).mockResolvedValue({ success: true, data: { active: null, history: granted.history } });
  render(<SupportAccessPage />);
  expect(await screen.findByText('CACU support has never had access to this business.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Grant access' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say briefly what support should look at.');
  expect(grantSupportAction).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('What should support look at?'), 'Stock count looks wrong');
  await userEvent.click(screen.getByLabelText('3 days'));
  await userEvent.click(screen.getByRole('button', { name: 'Grant access' }));
  await waitFor(() => expect(grantSupportAction).toHaveBeenCalledWith(72, 'Stock count looks wrong', false));  // pay not ticked
  expect(await screen.findByText(/CACU support can look at your business until/)).toBeInTheDocument();
  expect(screen.getByText(/Staff and pay records hidden/)).toBeInTheDocument();
  expect(screen.getByText(/Opened by Tolu \(CACU support\)/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'End access now' }));
  expect(await screen.findByRole('button', { name: 'Grant access' })).toBeInTheDocument();
});

test('only the owner can grant', async () => {
  (supportStatusAction as jest.Mock).mockResolvedValue({ success: false, error: 'Only the business owner can do this.' });
  render(<SupportAccessPage />);
  expect(await screen.findByText('Only the business owner can do this.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Grant access' })).not.toBeInTheDocument();
});

test('support sees granted businesses only after two-step sign-in, and opens one', async () => {
  (supportCasesAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { staff: false, two_step: false, cases: [] } });
  const { unmount } = render(<SupportCasesPage />);
  expect(await screen.findByText('This page is for CACU support staff.')).toBeInTheDocument();
  unmount();
  (supportCasesAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { staff: true, two_step: false, cases: [] } });
  const second = render(<SupportCasesPage />);
  expect(await screen.findByText(/needs two-step sign-in/)).toBeInTheDocument();
  second.unmount();
  (supportCasesAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { staff: true, two_step: true, cases: [
    { business_id: 'b1', name: 'Ada Provisions', reason: 'Stock count looks wrong', include_pay: false, expires_at: '2026-11-14T09:00:00Z', opened: false }] } });
  (openSupportCaseAction as jest.Mock).mockResolvedValue({ success: false, error: 'Support does not have access to this business now.' });
  render(<SupportCasesPage />);
  expect(await screen.findByText('Ada Provisions')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(openSupportCaseAction).toHaveBeenCalledWith('b1');
  expect(await screen.findByRole('alert')).toHaveTextContent('Support does not have access to this business now.');
});

test('every page says when support is viewing, read-only', async () => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue({ memberships: [], twoStep: null, closure: null,
    active: { business_id: 'b1', role: 'viewer', businesses: { id: 'b1', name: 'Ada Provisions' },
      support: { expires_at: '2026-11-14T09:00:00Z', include_pay: false, reason: 'Stock count looks wrong' } } });
  render(<BusinessProvider><p>Sales today</p></BusinessProvider>);
  expect(await screen.findByText(/viewing this business as CACU support, read-only/)).toBeInTheDocument();
  expect(screen.getByText('Sales today')).toBeInTheDocument();
});

test('only opened cases of a support person after two-step sign-in reach the switcher', async () => {
  const rpc = (data: unknown) => ({ rpc: jest.fn().mockResolvedValue({ data, error: null }) });
  const cases = [{ business_id: 'b1', opened: true }, { business_id: 'b2', opened: false }];
  expect(await openedSupportCases(rpc({ staff: true, two_step: true, cases }))).toEqual([cases[0]]);
  expect(await openedSupportCases(rpc({ staff: true, two_step: false, cases }))).toEqual([]);
  expect(await openedSupportCases(rpc({ staff: false, two_step: false, cases: [] }))).toEqual([]);
  expect(await openedSupportCases({ rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) })).toEqual([]);
});
