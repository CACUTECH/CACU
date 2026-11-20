import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShiftBar } from '@/components/shift-bar';
import ShiftsPage from '@/app/pos/shifts/page';
import POSPage from '@/app/pos/page';
import { cashMovementAction, closeShiftAction, getShiftAction, listShiftsAction, openShiftAction, saveShiftPolicyAction } from '@/app/pos/shift-actions';
import { getCheckoutOptionsAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { useBusiness } from '@/components/business-provider';
import { differenceKobo, differenceText } from '@/lib/shifts';
import { highlights } from '@/lib/billing';

jest.mock('@/app/pos/offline-actions', () => ({ syncOfflineSaleAction: jest.fn(), offlineReviewAction: jest.fn(), decideOfflineSaleAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn(), listShiftsAction: jest.fn(), openShiftAction: jest.fn(),
  cashMovementAction: jest.fn(), closeShiftAction: jest.fn(), saveShiftPolicyAction: jest.fn() }));
jest.mock('@/app/appointments/actions', () => ({ getBookingBillAction: jest.fn() }));
jest.mock('@/app/jobs/actions', () => ({ getJobMoneyAction: jest.fn() }));
jest.mock('@/app/pos/actions', () => ({ getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const rows = table === 'catalog_items' ? [{ id: 'beans', name: 'Beans', price: 1500, quantity: 3, type: 'PRODUCT', track_stock: true, status: 'active' }] : [];
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'order', 'limit', 'eq']) chain[step] = () => chain;
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
  return chain;
} }) }));

jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

const shift = { id: 'sh-1', status: 'open', opened_by_name: 'Till 1', mine: true, opened_at: '2026-11-07T07:05:00Z', opened_on: '2026-11-07', overdue: false,
  opening_float: '5000.00', sales: 3, cash_sales: '4000.00', cash_refunds: '0.00', pay_ins: '2000.00', pay_outs: '1700.00', cash_handed_back: '0.00',
  expected_cash: '9300.00', counted_cash: null, variance: null, close_note: null, closed_on: null, movements: [] };
const fuel = { id: 'fuel', code: '6300', name: 'Transport and logistics' };

beforeEach(() => {
  jest.clearAllMocks();
  (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'b1', userRole: 'owner' } });
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false, refund_threshold: null, require_shift: false });
});

test('differences read as short or over, and shifts are listed on the Oga and Chairman plans', () => {
  expect(differenceKobo('9000', '9300.00')).toBe(-30000);
  expect(differenceKobo('9,000', '9300.00')).toBeNull();
  expect([differenceText(-30000), differenceText('100.00'), differenceText('0.00')]).toEqual(['₦300.00 short', '₦100.00 over', 'No difference']);
  expect(highlights({ 'module.shifts': true })).toContain('Cashier shifts and cash counts');
  expect(highlights({ 'module.shifts': false })).not.toContain('Cashier shifts and cash counts');
});

test('opening a shift keeps its request key when the response is lost', async () => {
  (getShiftAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { available: true, require_shift: true, shift: null, can_manage: false } })
    .mockResolvedValue({ success: true, data: { available: true, require_shift: true, shift, can_manage: false, pay_out_accounts: [fuel] } });
  (openShiftAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The change was not confirmed. Refresh before trying again.', uncertain: true })
    .mockResolvedValueOnce({ success: true, data: shift });
  const onStatus = jest.fn();
  render(<ShiftBar banks={[]} onStatus={onStatus} />);
  expect(await screen.findByText('The owner requires a shift before you sell.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
  await userEvent.type(screen.getByLabelText('Cash in the till now (₦)'), '5000');
  await userEvent.click(screen.getAllByRole('button', { name: 'Open shift' }).at(-1)!);
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  expect(screen.getByLabelText('Cash in the till now (₦)')).toBeDisabled();
  await userEvent.click(screen.getAllByRole('button', { name: 'Open shift' }).at(-1)!);
  expect(await screen.findByText('Shift opened with ₦5,000.00 in the till.')).toBeInTheDocument();
  const [first, second] = (openShiftAction as jest.Mock).mock.calls;
  expect(first).toEqual(['key-1', '5000']);
  expect(second[0]).toBe(first[0]);
  expect(await screen.findByText('₦9,300.00')).toBeInTheDocument();
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ shift }));
});

test('a pay-out needs what it was for and a reason, and closing short needs an explanation', async () => {
  (getShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { available: true, require_shift: false, shift, can_manage: false, pay_out_accounts: [fuel] } });
  (cashMovementAction as jest.Mock).mockResolvedValue({ success: true, data: shift });
  (closeShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { ...shift, status: 'closed', variance: '-300.00' } });
  render(<ShiftBar banks={[{ id: 'gtb', name: 'GTBank' }]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Pay in or out' }));
  await userEvent.type(screen.getByLabelText('Amount (₦)'), '700');
  expect(screen.getByRole('alert')).toHaveTextContent('Say what the cash is for');
  await userEvent.type(screen.getByLabelText('Reason'), 'Diesel');
  expect(screen.getByRole('alert')).toHaveTextContent('Choose what the cash was spent on');
  await userEvent.selectOptions(screen.getByLabelText('Spent on'), 'fuel');
  await userEvent.click(screen.getByRole('button', { name: 'Record pay-out' }));
  await waitFor(() => expect(cashMovementAction).toHaveBeenCalledWith('sh-1', { requestKey: expect.any(String), kind: 'pay_out', amount: '700',
    reason: 'Diesel', expenseAccountId: 'fuel', bankAccountId: undefined }));
  expect(await screen.findByText('₦700.00 paid out of the till.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Close shift' }));
  expect(screen.getByText('Expected cash')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cash counted (₦)'), '9000');
  expect(screen.getByText('₦300.00 short')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Say what happened to the difference');
  await userEvent.type(screen.getByLabelText('What happened'), 'Gave too much change');
  await userEvent.click(screen.getAllByRole('button', { name: 'Close shift' }).at(-1)!);
  await waitFor(() => expect(closeShiftAction).toHaveBeenCalledWith('sh-1', expect.any(String), '9000', 'Gave too much change'));
  expect(await screen.findByText('Shift closed. ₦300.00 short.')).toBeInTheDocument();
});

test('the till will not check out without a shift when the owner requires one', async () => {
  (getShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { available: true, require_shift: true, shift: null, can_manage: false } });
  render(<POSPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Beans/ }));
  expect(await screen.findByText('The owner requires a shift before you sell.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Complete Checkout' })).toBeDisabled();
});

test('shifts are hidden on the General plan', async () => {
  (getShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { available: false, require_shift: false, shift: null, can_manage: false } });
  (listShiftsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  const { container } = render(<ShiftBar banks={[]} />);
  await waitFor(() => expect(getShiftAction).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  render(<ShiftsPage />);
  expect(await screen.findByText(/come with the Oga and Chairman plans/)).toBeInTheDocument();
});

test("the owner requires shifts, and a manager closes a cashier's forgotten shift", async () => {
  const forgotten = { ...shift, id: 'sh-2', mine: false, opened_by_name: 'Till 2', overdue: true, opened_on: '2026-11-06' };
  (getShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { available: true, require_shift: false, shift: null, can_manage: true } });
  (listShiftsAction as jest.Mock).mockResolvedValue({ success: true, data: [forgotten] });
  (saveShiftPolicyAction as jest.Mock).mockResolvedValue({ success: true, data: { require_shift: true } });
  (closeShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { ...forgotten, status: 'closed', variance: '0.00' } });
  render(<ShiftsPage />);
  expect(await screen.findByText('Open past midnight')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Require a shift to sell' }));
  expect(saveShiftPolicyAction).toHaveBeenCalledWith(true);
  expect(await screen.findByText('Everyone now needs an open shift to sell.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByText("Close Till 2's shift")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cash counted (₦)'), '9300');
  await userEvent.click(screen.getByRole('button', { name: 'Close shift' }));
  await waitFor(() => expect(closeShiftAction).toHaveBeenCalledWith('sh-2', expect.any(String), '9300', ''));
  expect(await screen.findByText('Shift closed. No difference.')).toBeInTheDocument();
});

test('with several outlets the till opens at a chosen outlet, and sells from it', async () => {
  const outlets = [{ id: 'ikeja', name: 'Ikeja shop' }, { id: 'yaba', name: 'Yaba shop' }];
  (getShiftAction as jest.Mock).mockResolvedValue({ success: true, data: { available: true, require_shift: false, shift: null, can_manage: false, outlets, own_outlet: null } });
  (openShiftAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { ...shift, outlet: 'Yaba shop' } });
  render(<ShiftBar banks={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open shift' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the outlet this till is in.');
  await userEvent.selectOptions(screen.getByLabelText('Outlet'), 'yaba');
  await userEvent.click(screen.getAllByRole('button', { name: 'Open shift' }).at(-1)!);
  expect(await screen.findByText(/Shift opened at Yaba shop with/)).toBeInTheDocument();
  expect((openShiftAction as jest.Mock).mock.calls.at(-1)).toEqual([expect.any(String), '0', 'yaba']);
});

