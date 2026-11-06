import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefundDialog } from '@/components/refund-dialog';
import POSPage from '@/app/pos/page';
import { getCheckoutOptionsAction, getRefundableAction, requestRefundAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { refundKobo, refundWaits } from '@/lib/checkout';

jest.mock('@/app/pos/actions', () => ({ getRefundableAction: jest.fn(), requestRefundAction: jest.fn(), getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn().mockResolvedValue({ success: true, data: null }) }));
jest.mock('@/app/appointments/actions', () => ({ getBookingBillAction: jest.fn() }));
jest.mock('@/app/jobs/actions', () => ({ getJobMoneyAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

// A small Data API stand-in: reads return the table's rows; parking inserts, resuming deletes.
const mockDb: { parked_sales: Record<string, unknown>[]; inserted: unknown[]; deleted: string[] } = { parked_sales: [], inserted: [], deleted: [] };
const mockRows: Record<string, () => unknown[]> = {
  catalog_items: () => [{ id: 'beans', name: 'Beans', price: 1500, quantity: 3, type: 'PRODUCT', track_stock: true, status: 'active' }],
  customers: () => [], parked_sales: () => mockDb.parked_sales,
};
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const chain: Record<string, unknown> = {};
  let deleting = false, id = '';
  for (const step of ['select', 'order', 'limit']) chain[step] = () => chain;
  chain.eq = (_: string, value: string) => { id = value; return chain; };
  chain.insert = (row: unknown) => { mockDb.inserted.push(row); return Promise.resolve({ error: null }); };
  chain.delete = () => { deleting = true; return chain; };
  chain.then = (resolve: (value: unknown) => void) => {
    if (deleting) { mockDb.deleted.push(id); mockDb.parked_sales = mockDb.parked_sales.filter(p => p.id !== id); return resolve({ data: [{ id }], error: null }); }
    return resolve({ data: mockRows[table](), error: null });
  };
  return chain;
} }) }));

jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

const refundable = { sale_id: 's-1', number: 'CS-0004', date: '2026-11-07', status: 'completed', method: 'cash', default_method: 'Cash',
  total: '5550.00', refunded_total: '0.00', refund_threshold: null, can_approve: false,
  lines: [{ line_id: 'l-beans', item_id: 'beans', name: 'Beans', quantity: 3, refundable: 3, refundable_amount: '4050.00', restockable: true },
          { line_id: 'l-delivery', item_id: 'delivery', name: 'Delivery', quantity: 1, refundable: 0, refundable_amount: '0.00', restockable: false }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.parked_sales = []; mockDb.inserted = []; mockDb.deleted = [];
  (getRefundableAction as jest.Mock).mockResolvedValue({ success: true, data: refundable });
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false, refund_threshold: null });
});

test('refund amounts follow the server: the rest of the line shared by unit, rounded half up', () => {
  expect(refundKobo({ refundable: 3, refundable_amount: '4050.00' }, 1)).toBe(135000);
  expect(refundKobo({ refundable: 3, refundable_amount: '100.00' }, 1)).toBe(3333);
  expect(refundKobo({ refundable: 3, refundable_amount: '100.00' }, 3)).toBe(10000);  // the last units take what is left
  expect(refundKobo({ refundable: 3, refundable_amount: '100.00' }, 4)).toBe(0);
  expect(refundWaits(500000, { can_approve: true, refund_threshold: '5000.00' })).toBe(false);
  expect(refundWaits(500001, { can_approve: true, refund_threshold: '5000.00' })).toBe(true);
  expect(refundWaits(100, { can_approve: false, refund_threshold: null })).toBe(true);
});

test("a cashier's refund asks for approval, and a lost response keeps the same request key", async () => {
  (requestRefundAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The refund was not confirmed. Refresh before trying again.', uncertain: true })
    .mockResolvedValueOnce({ success: true, data: { status: 'pending' } });
  const onDone = jest.fn();
  render(<RefundDialog saleId="s-1" open onClose={jest.fn()} onDone={onDone} />);
  expect(await screen.findByText('Already refunded')).toBeInTheDocument();
  expect(screen.getByLabelText('Quantity of Delivery to refund')).toBeDisabled();
  const quantity = screen.getByLabelText('Quantity of Beans to refund');
  await userEvent.clear(quantity); await userEvent.type(quantity, '4');
  expect(screen.getByRole('alert')).toHaveTextContent('no more than what can still be refunded');
  await userEvent.clear(quantity); await userEvent.type(quantity, '1');
  expect(screen.getByRole('alert')).toHaveTextContent('Say why');
  await userEvent.type(screen.getByLabelText('Reason'), 'Wrong size');
  expect(screen.getByText('₦1,350.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ask for approval' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  await userEvent.click(screen.getByRole('button', { name: 'Ask for approval' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Refund of ₦1,350.00 is waiting for approval on Daily reconciliation.'));
  const [[, first], [, second]] = (requestRefundAction as jest.Mock).mock.calls;
  expect(first).toEqual({ requestKey: second.requestKey, method: 'Cash', bankAccountId: undefined, reason: 'Wrong size',
    lines: [{ lineId: 'l-beans', quantity: 1, restock: true }] });
});

test('an approver within the limit refunds now, and a transfer refund needs the bank', async () => {
  (getRefundableAction as jest.Mock).mockResolvedValue({ success: true, data: { ...refundable, can_approve: true } });
  (requestRefundAction as jest.Mock).mockResolvedValue({ success: true, data: { status: 'posted' } });
  const onDone = jest.fn();
  render(<RefundDialog saleId="s-1" open onClose={jest.fn()} onDone={onDone} />);
  const quantity = await screen.findByLabelText('Quantity of Beans to refund');
  await userEvent.clear(quantity); await userEvent.type(quantity, '3');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Back to stock' }));
  await userEvent.type(screen.getByLabelText('Reason'), 'Spoilt');
  await userEvent.click(screen.getByRole('radio', { name: 'Bank transfer' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the bank account');
  await userEvent.selectOptions(screen.getByLabelText(/Bank account it is paid from/), 'gtb');
  await userEvent.click(screen.getByRole('button', { name: 'Refund now' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Refunded ₦4,050.00. Send it to the customer by transfer.'));
  expect((requestRefundAction as jest.Mock).mock.calls[0][1]).toMatchObject({ method: 'Transfer', bankAccountId: 'gtb', lines: [{ lineId: 'l-beans', quantity: 3, restock: false }] });
});

test('a parked sale is saved without posting and resumed on the till', async () => {
  render(<POSPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Beans/ }));
  await userEvent.click(screen.getByRole('button', { name: 'One more Beans' }));
  await userEvent.click(screen.getByRole('button', { name: 'Park sale' }));
  await userEvent.type(screen.getByLabelText('Name (optional)'), 'Ada');
  mockDb.parked_sales = [{ id: 'p-1', label: 'Ada', items: [{ item_id: 'beans', quantity: 2, discount_percent: '0' }], created_at: '2026-11-07T10:00:00Z' }];
  await userEvent.click(screen.getAllByRole('button', { name: 'Park sale' }).at(-1)!);
  await waitFor(() => expect(mockDb.inserted).toEqual([{ business_id: 'b1', label: 'Ada', items: [{ item_id: 'beans', quantity: 2, discount_percent: '0' }] }]));
  expect(await screen.findByText('Cart is empty')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Parked sales (1)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(mockDb.deleted).toEqual(['p-1']));
  expect(await screen.findByRole('button', { name: 'One more Beans' })).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});
