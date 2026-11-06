import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import POSPage from '@/app/pos/page';
import { getCheckoutOptionsAction, processCheckoutAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';

jest.mock('@/app/pos/actions', () => ({ getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn().mockResolvedValue({ success: true, data: null }) }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
const mockRows: Record<string, unknown[]> = {
  catalog_items: [{ id: 'beans', name: 'Beans', price: 1500, quantity: 3, type: 'PRODUCT', track_stock: true, status: 'active' }],
  customers: [{ id: 'ada', name: 'Ada Stores' }],
};
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'eq', 'order']) chain[step] = () => chain;
  chain.limit = () => Promise.resolve({ data: mockRows[table], error: null });
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: mockRows[table], error: null });
  return chain;
} }) }));

jest.setTimeout(20000);  // several typed fields per test; slow under the full parallel run
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

beforeEach(() => {
  jest.clearAllMocks();
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false });
  (processCheckoutAction as jest.Mock).mockResolvedValue({ success: true, saleId: 'sale-1', status: 'completed', change: '575.00', invoiceNumber: null, shortfalls: [] });
});

async function cartWithTwoBeans() {
  render(<POSPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Beans/ }));
  await userEvent.click(screen.getByRole('button', { name: 'One more Beans' }));
}

test('a discount above the cap blocks checkout; within it the total and change follow', async () => {
  await cartWithTwoBeans();
  const discount = screen.getByLabelText('Discount for Beans (%)');
  await userEvent.clear(discount); await userEvent.type(discount, '6');
  expect(screen.getByRole('button', { name: 'Complete Checkout' })).toBeDisabled();
  await userEvent.clear(discount); await userEvent.type(discount, '5');
  expect(screen.getByText('₦2,850.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.type(screen.getByLabelText('Cash received (₦, optional)'), '3425');
  expect(screen.getByText('Change: ₦575.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  await waitFor(() => expect(processCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'Cash', cashReceived: '3425', totalAmount: 28.5 * 100 / 1,
    items: [expect.objectContaining({ id: 'beans', quantity: 2, discountPercent: '5' })] })));
  expect(await screen.findByText('Give change: ₦575.00')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Receipt' })).toHaveAttribute('href', '/pos/receipt/sale-1');
});

test('a split sale needs a transfer part smaller than the total and shows the cash due', async () => {
  await cartWithTwoBeans();
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Cash + transfer' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a transfer amount less than the total.');
  await userEvent.type(screen.getByLabelText('Paid by transfer (₦)'), '1000');
  expect(screen.getByText('Cash due: ₦2,000.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  await waitFor(() => expect(processCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'Split', transferAmount: '1000.00', totalAmount: 3000 })));
});

test('a credit sale needs a customer and has no discount', async () => {
  (processCheckoutAction as jest.Mock).mockResolvedValue({ success: true, saleId: 'inv-1', status: 'credit', change: null, invoiceNumber: 'POS-KEY', shortfalls: [] });
  await cartWithTwoBeans();
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.click(screen.getByRole('radio', { name: 'On credit' }));
  expect(screen.getByRole('button', { name: 'Confirm & Record Sale' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText(/Customer who owes/), 'ada');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  await waitFor(() => expect(processCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'Credit', customerId: 'ada' })));
  expect(await screen.findByText('Credit sale recorded as invoice POS-KEY.')).toBeInTheDocument();
});

test('the till stops at recorded stock unless the owner allowed overselling', async () => {
  render(<POSPage />);
  const beans = await screen.findByRole('button', { name: /Beans/ });
  for (let i = 0; i < 5; i += 1) await userEvent.click(beans);
  expect(screen.getByText('3')).toBeInTheDocument();
});
