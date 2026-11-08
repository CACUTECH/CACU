import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import POSPage from '@/app/pos/page';
import OfflinePage from '@/app/settings/offline/page';
import { getCheckoutOptionsAction, processCheckoutAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { decideOfflineSaleAction, offlineReviewAction, syncOfflineExpenseAction, syncOfflineSaleAction } from '@/app/pos/offline-actions';
import { forgetSale, keepExpense, keepSale, markSale, salesOnDevice, type OfflinePayload, type OutboxEntry } from '@/lib/offline-outbox';

jest.mock('@/app/pos/offline-actions', () => ({ syncOfflineExpenseAction: jest.fn(), syncOfflineSaleAction: jest.fn(), offlineReviewAction: jest.fn(), decideOfflineSaleAction: jest.fn() }));
jest.mock('@/lib/offline-outbox', () => ({ keepSale: jest.fn().mockResolvedValue(undefined), keepExpense: jest.fn().mockResolvedValue(undefined), salesOnDevice: jest.fn().mockResolvedValue([]),
  markSale: jest.fn(), forgetSale: jest.fn(), saveSnapshot: jest.fn().mockResolvedValue(undefined), loadSnapshot: jest.fn().mockResolvedValue(null),
  online: () => navigator.onLine !== false }));
jest.mock('@/app/accounting/expenses/actions', () => ({ getExpensesAction: jest.fn(), recordExpenseAction: jest.fn(), reverseExpenseAction: jest.fn() }));
jest.mock('@/app/pos/actions', () => ({ getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn().mockResolvedValue({ success: true, data: null }) }));
jest.mock('@/app/appointments/actions', () => ({ getBookingBillAction: jest.fn() }));
jest.mock('@/app/jobs/actions', () => ({ getJobMoneyAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', name: 'Ada Provisions', userRole: 'owner' } }) }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'order']) chain[step] = () => chain;
    const rows = table === 'catalog_items' ? [{ id: 'beans', name: 'Beans', price: 1500, quantity: 3, type: 'PRODUCT', track_stock: true, status: 'active' }] : [];
    chain.limit = () => Promise.resolve({ data: rows, error: null });
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
    return chain;
  },
}) }));
jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
const salePayload: OfflinePayload = { request_key: 'k1', sold_at: '2026-11-08T09:00:00Z', method: 'Cash', bank_account_id: null, cash_received: null, location_id: null,
  quoted_total: '3000.00', items: [{ item_id: 'beans', quantity: 2, unit_price: '1500.00', discount_percent: '0' }] };
const entry = (over: Record<string, unknown> = {}) => ({ key: 'k1', business_id: 'b1', user_id: 'u1', names: { beans: 'Beans' }, status: 'pending', detail: null,
  attempts: 0, created_at: '2026-11-08T09:00:00Z', updated_at: '2026-11-08T09:00:00Z', kind: 'sale', payload: salePayload, ...over }) as OutboxEntry;

beforeEach(() => {
  jest.clearAllMocks();
  setOnline(true);
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false });
  (salesOnDevice as jest.Mock).mockResolvedValue([]);
});

test('offline, the till keeps a cash sale on the phone at the prices shown and does not record it online', async () => {
  render(<POSPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Beans/ }));
  await userEvent.click(screen.getByRole('button', { name: 'One more Beans' }));
  setOnline(false);
  act(() => { window.dispatchEvent(new Event('offline')); });
  expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.click(screen.getByRole('radio', { name: 'On credit' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Without internet, take cash or a transfer.');
  await userEvent.click(screen.getByRole('radio', { name: 'Cash' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  expect(await screen.findByText('Sale saved on this phone. It will be sent when you are back online.')).toBeInTheDocument();
  expect(processCheckoutAction).not.toHaveBeenCalled();
  expect(keepSale).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'b1', user_id: 'u1', payload: expect.objectContaining({
    method: 'Cash', quoted_total: '3000.00', items: [{ item_id: 'beans', quantity: 2, unit_price: '1500.00', discount_percent: '0' }] }) }));
  expect(screen.queryByRole('link', { name: 'Receipt' })).not.toBeInTheDocument();
});

test('back online, sales are sent: posted ones leave the phone, review ones stay marked, approvers decide', async () => {
  (salesOnDevice as jest.Mock).mockResolvedValue([entry(), entry({ key: 'k2', payload: { ...salePayload, request_key: 'k2' } })]);
  (syncOfflineSaleAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { status: 'posted', sale_id: 'k1' } })
    .mockResolvedValueOnce({ success: true, data: { status: 'review', sale_id: 'k2', reason: 'price', detail: 'Beans: sold at ₦1,500.00, catalogue price then ₦1,800.00' } });
  (offlineReviewAction as jest.Mock).mockResolvedValue({ success: true, data: { can_decide: true, sales: [{ id: 'k2', kind: 'sale', can_decide: true, seller: 'Bisi', sold_at: '2026-11-08T09:00:00Z',
    method: 'Cash', total: '3000.00', reason: 'price', reason_text: 'A price differs from the catalogue price at the time of the sale', detail: 'Beans: sold at ₦1,500.00, catalogue price then ₦1,800.00',
    items: [{ name: 'Beans', quantity: 2, unit_price: '1500.00', discount_percent: '0' }] }] } });
  (decideOfflineSaleAction as jest.Mock).mockResolvedValue({ success: true, data: { status: 'discarded', sale_id: 'k2' } });
  render(<OfflinePage />);
  await waitFor(() => expect(syncOfflineSaleAction).toHaveBeenCalledTimes(2));
  expect(forgetSale).toHaveBeenCalledWith('k1');
  expect(markSale).toHaveBeenCalledWith('k2', { status: 'review', detail: 'Beans: sold at ₦1,500.00, catalogue price then ₦1,800.00' });
  expect(await screen.findByText(/A price differs from the catalogue price at the time of the sale: Beans/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say why this sale is discarded.');
  await userEvent.type(screen.getByLabelText('Note'), 'Customer returned it');
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(decideOfflineSaleAction).toHaveBeenCalledWith('k2', 'discard', 'Customer returned it'));
  expect(await screen.findByText('Sale discarded.')).toBeInTheDocument();
});

test('a lost answer keeps the sale waiting and stops for now; a sale made by someone else is not sent', async () => {
  (salesOnDevice as jest.Mock).mockResolvedValue([entry({ key: 'other', user_id: 'u2' }), entry(), entry({ key: 'k3' })]);
  (syncOfflineSaleAction as jest.Mock).mockResolvedValue({ success: false, error: 'Not sent yet. It will be tried again.', uncertain: true });
  (offlineReviewAction as jest.Mock).mockResolvedValue({ success: true, data: { can_decide: false, sales: [] } });
  render(<OfflinePage />);
  await waitFor(() => expect(markSale).toHaveBeenCalledWith('k1', { attempts: 1, detail: 'Not sent yet. It will be tried again.' }));
  expect(syncOfflineSaleAction).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Made by someone else on this phone/)).toBeInTheDocument();
});

test('offline, an expense waits on the phone and is sent with its own request', async () => {
  const { default: ExpensesPage } = await import('@/app/accounting/expenses/page');
  const { getExpensesAction } = await import('@/app/accounting/expenses/actions');
  (getExpensesAction as jest.Mock).mockResolvedValue({ success: true, data: { native: true, accounts: [{ id: 'fuel', code: '6300', name: 'Fuel and power' }],
    banks: [], expenses: [] } });
  render(<ExpensesPage />);
  await userEvent.selectOptions(await screen.findByLabelText('Expense account'), 'fuel');
  await userEvent.type(screen.getByLabelText('Amount (NGN)'), '2500');
  await userEvent.type(screen.getByLabelText('Description'), 'Diesel for the generator');
  setOnline(false);
  act(() => { window.dispatchEvent(new Event('offline')); });
  await userEvent.click(screen.getByRole('button', { name: 'Record expense' }));
  expect(await screen.findByText('Expense saved on this phone. It will be sent when you are back online.')).toBeInTheDocument();
  expect(keepExpense).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'b1', user_id: 'u1', payload: expect.objectContaining({
    expense_account_id: 'fuel', amount: '2500', method: 'Cash', description: 'Diesel for the generator' }) }));
  const { recordExpenseAction } = await import('@/app/accounting/expenses/actions');
  expect(recordExpenseAction).not.toHaveBeenCalled();

  (salesOnDevice as jest.Mock).mockResolvedValue([entry({ key: 'e1', kind: 'expense', payload: { request_key: 'e1', recorded_at: '2026-11-08T09:00:00Z',
    expense_account_id: 'fuel', amount: '2500', entry_date: '2026-11-08', method: 'Cash', bank_account_id: null, description: 'Diesel' } })]);
  (syncOfflineExpenseAction as jest.Mock).mockResolvedValue({ success: true, data: { status: 'posted', sale_id: 'e1' } });
  setOnline(true);
  act(() => { window.dispatchEvent(new Event('online')); });
  await waitFor(() => expect(syncOfflineExpenseAction).toHaveBeenCalledWith(expect.objectContaining({ request_key: 'e1', amount: '2500' })));
  await waitFor(() => expect(forgetSale).toHaveBeenCalledWith('e1'));
});
