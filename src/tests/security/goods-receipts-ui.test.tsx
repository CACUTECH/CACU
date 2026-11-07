import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiveGoodsDialog } from '@/components/receive-goods-dialog';
import ReceiptPage from '@/app/purchases/receipts/[id]/page';
import PurchaseOrderPage from '@/app/purchases/[id]/page';
import { billReceivedAction, getReceiptAction, listReceiptsAction, receiveGoodsAction, returnGoodsAction } from '@/app/purchases/actions';

jest.mock('@/app/purchases/actions', () => ({ billReceivedAction: jest.fn(), listReceiptsAction: jest.fn(), getReceiptAction: jest.fn(), receiveGoodsAction: jest.fn(), returnGoodsAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', name: 'Ada Provisions', userRole: 'owner' } }) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'gr1' }) }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  rpc: () => Promise.resolve({ data: true, error: null }),
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'order', 'limit', 'eq', 'in']) chain[step] = () => chain;
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: mockRows[table] ?? [], error: null });
    return chain;
  },
}) }));

jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const receipt = { id: 'gr1', number: 'GR-0001', order_id: 'po1', order_number: 'PO-0001', supplier_id: 's1', supplier_name: 'Mills Ltd', received_on: '2026-11-09',
  total: '26000.00', note: '', lines: [{ item_id: 'beans', name: 'Beans', quantity: 20, unit_cost: '1300.0000', amount: '26000.00', returned_quantity: 0, billed_quantity: 0, returnable: 20 }],
  returns: [] };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockRows, {
    purchase_orders: [{ id: 'po1', number: 'PO-0001', supplier_id: 's1', status: 'sent', expected_date: null, notes: '', created_at: '2026-11-07T08:00:00Z', sent_at: '2026-11-07T09:00:00Z', cancel_reason: null }],
    purchase_order_lines: [{ id: 'l1', item_id: 'beans', quantity: 24, unit_cost: '1200.5000', received_quantity: 0 }],
    catalog_items: [{ id: 'beans', name: 'Beans', cost_price: '1200.5', stock_quantity: 3, item_type: 'PRODUCT', track_stock: true }],
    suppliers: [{ id: 's1', name: 'Mills Ltd', phone: null, email: null }],
  });
});

test('receiving against an order offers what is still to come and keeps its key when the response is lost', async () => {
  (receiveGoodsAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The change was not confirmed. Refresh before trying again.', uncertain: true })
    .mockResolvedValueOnce({ success: true, data: receipt });
  const onDone = jest.fn();
  render(<ReceiveGoodsDialog orderId="po1" lines={[{ itemId: 'beans', name: 'Beans', remaining: 24, unitCost: '1200.5' }]} onClose={jest.fn()} onDone={onDone} />);
  const quantity = screen.getByLabelText('Quantity of Beans received');
  expect(quantity).toHaveValue('24');
  await userEvent.clear(quantity); await userEvent.type(quantity, '25');
  expect(screen.getByRole('alert')).toHaveTextContent('Only 24 Beans are still to come on this order.');
  await userEvent.clear(quantity); await userEvent.type(quantity, '20');
  await userEvent.clear(screen.getByLabelText('Unit cost of Beans')); await userEvent.type(screen.getByLabelText('Unit cost of Beans'), '1300');
  expect(screen.getByText('Total: ₦26,000.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Receive goods' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  expect(quantity).toBeDisabled();  // the same delivery is retried, not changed
  await userEvent.click(screen.getByRole('button', { name: 'Receive goods' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(receipt));
  const [[first], [second]] = (receiveGoodsAction as jest.Mock).mock.calls;
  expect(first).toEqual({ requestKey: second.requestKey, orderId: 'po1', supplierId: undefined, note: '', lines: [{ itemId: 'beans', quantity: 20, unitCost: '1300' }] });
});

test('a delivery without an order needs the supplier and its products', async () => {
  (receiveGoodsAction as jest.Mock).mockResolvedValue({ success: true, data: receipt });
  render(<ReceiveGoodsDialog suppliers={[{ id: 's1', name: 'Mills Ltd', phone: null, email: null }, { id: 's2', name: 'Kemi Foods', phone: null, email: null }]}
    products={[{ id: 'beans', name: 'Beans', cost_price: '1200.5' }]} onClose={jest.fn()} onDone={jest.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the supplier');
  await userEvent.selectOptions(screen.getByLabelText('Supplier'), 's2');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter what arrived.');
  await userEvent.selectOptions(screen.getByLabelText('Add a product'), 'beans');
  expect(screen.getByLabelText('Unit cost of Beans')).toHaveValue('1200.5');
  await userEvent.type(screen.getByLabelText('Delivery note or reference (optional)'), 'DN 77');
  await userEvent.click(screen.getByRole('button', { name: 'Receive goods' }));
  await waitFor(() => expect(receiveGoodsAction).toHaveBeenCalledWith({ requestKey: expect.any(String), orderId: undefined, supplierId: 's2', note: 'DN 77',
    lines: [{ itemId: 'beans', quantity: 1, unitCost: '1200.5' }] }));
});

test('goods go back to the supplier from a receipt, up to what is left, with a reason', async () => {
  (getReceiptAction as jest.Mock).mockResolvedValue({ success: true, data: receipt });
  (returnGoodsAction as jest.Mock).mockResolvedValue({ success: true, data: { ...receipt, lines: [{ ...receipt.lines[0], returned_quantity: 2, returnable: 18 }],
    returns: [{ id: 'r1', reason: 'Two tins dented', returned_on: '2026-11-09', total: '2600.00' }] } });
  render(<ReceiptPage />);
  expect(await screen.findByRole('heading', { name: 'GR-0001' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Return to supplier' }));
  await userEvent.type(screen.getByLabelText('Quantity of Beans to return'), '21');
  expect(screen.getByRole('alert')).toHaveTextContent('at most 20 Beans');
  await userEvent.clear(screen.getByLabelText('Quantity of Beans to return')); await userEvent.type(screen.getByLabelText('Quantity of Beans to return'), '2');
  expect(screen.getByRole('alert')).toHaveTextContent('Say why');
  await userEvent.type(screen.getByLabelText('Reason'), 'Two tins dented');
  await userEvent.click(screen.getByRole('button', { name: 'Return goods' }));
  await waitFor(() => expect(returnGoodsAction).toHaveBeenCalledWith('gr1', { requestKey: expect.any(String), reason: 'Two tins dented', lines: [{ itemId: 'beans', quantity: 2 }] }));
  expect(await screen.findByText('Returned ₦2,600.00 of goods. Stock and what you owe the supplier went down.')).toBeInTheDocument();
  expect(screen.getByText('2026-11-09: ₦2,600.00, Two tins dented')).toBeInTheDocument();
});

test('a sent order offers receiving once the books are on, and lists its receipts', async () => {
  (listReceiptsAction as jest.Mock).mockResolvedValue({ success: true, data: [receipt] });
  render(<PurchaseOrderPage />);
  expect(await screen.findByRole('button', { name: 'Receive goods' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'GR-0001' })).toHaveAttribute('href', '/purchases/receipts/gr1');
});

test("the supplier's bill starts at the received value and shows how a different amount moves the cost", async () => {
  (getReceiptAction as jest.Mock).mockResolvedValue({ success: true, data: receipt });
  (billReceivedAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'b1', bill_number: 'INV-101', total: '27000.00', received_value: '26000.00',
    difference_to_stock: '1000.00', difference_to_cost_of_sales: '0.00' } });
  render(<ReceiptPage />);
  expect(await screen.findByRole('heading', { name: 'GR-0001' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: "Enter supplier's bill" }));
  expect(screen.getByLabelText('Amount billed for Beans')).toHaveValue('26000.00');
  expect(screen.getByRole('alert')).toHaveTextContent("Enter the supplier's bill number.");
  await userEvent.type(screen.getByLabelText('Bill number'), 'INV-101');
  await userEvent.clear(screen.getByLabelText('Quantity of Beans billed')); await userEvent.type(screen.getByLabelText('Quantity of Beans billed'), '21');
  expect(screen.getByRole('alert')).toHaveTextContent('up to 20');
  await userEvent.clear(screen.getByLabelText('Quantity of Beans billed')); await userEvent.type(screen.getByLabelText('Quantity of Beans billed'), '20');
  await userEvent.clear(screen.getByLabelText('Amount billed for Beans')); await userEvent.type(screen.getByLabelText('Amount billed for Beans'), '27000');
  expect(screen.getByText(/The ₦1,000.00 difference adds to the cost of these goods/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Record bill' }));
  await waitFor(() => expect(billReceivedAction).toHaveBeenCalledWith({ requestKey: expect.any(String), supplierId: 's1', billNumber: 'INV-101', entryDate: expect.any(String),
    dueDate: undefined, notes: '', lines: [{ receiptId: 'gr1', itemId: 'beans', quantity: 20, amount: '27000' }] }));
  expect(await screen.findByText(/Bill INV-101 for ₦27,000.00 recorded/)).toBeInTheDocument();
});
