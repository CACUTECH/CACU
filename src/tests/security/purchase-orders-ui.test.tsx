import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PurchasesPage from '@/app/purchases/page';
import PurchaseOrderPage from '@/app/purchases/[id]/page';
import { orderError, orderText, orderTotalKobo, whatsappNumber } from '@/lib/purchasing';
import { isRouteAvailableInMode } from '@/lib/business-mode';

jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', name: 'Ada Provisions', userRole: 'owner' } }) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'po1' }) }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

// A small Data API stand-in: reads return each table's rows; writes are recorded and answered from mockDb.reply.
const mockDb: { rows: Record<string, unknown[]>; allowed: boolean; writes: { table: string; kind: string; value?: unknown }[];
  reply: { data: unknown[] | null; error: { message: string; code?: string } | null } } = { rows: {}, allowed: true, writes: [], reply: { data: [{ id: 'x' }], error: null } };
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  rpc: () => Promise.resolve({ data: mockDb.allowed, error: null }),
  from: (table: string) => {
    let write: { table: string; kind: string; value?: unknown } | null = null;
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'order', 'limit', 'eq', 'in']) chain[step] = () => chain;
    chain.insert = (value: unknown) => { write = { table, kind: 'insert', value }; return chain; };
    chain.update = (value: unknown) => { write = { table, kind: 'update', value }; return chain; };
    chain.delete = () => { write = { table, kind: 'delete' }; return chain; };
    chain.then = (resolve: (value: unknown) => void) => {
      if (write) { mockDb.writes.push(write); return resolve(mockDb.reply); }
      return resolve({ data: mockDb.rows[table] ?? [], error: null });
    };
    return chain;
  },
}) }));

jest.setTimeout(20000);
const order = { id: 'po1', number: 'PO-0001', supplier_id: 's1', status: 'draft', expected_date: '2026-11-12', notes: 'Call before delivery',
  created_at: '2026-11-07T08:00:00Z', sent_at: null, cancel_reason: null };

beforeEach(() => {
  mockDb.writes = []; mockDb.allowed = true; mockDb.reply = { data: [{ id: 'x' }], error: null };
  mockDb.rows = {
    purchase_orders: [order], purchase_order_lines: [{ id: 'l1', item_id: 'beans', quantity: 24, unit_cost: '1200.5000', received_quantity: 0 }],
    catalog_items: [{ id: 'beans', name: 'Beans', cost_price: '1200.5', stock_quantity: 3, item_type: 'PRODUCT', track_stock: true },
                    { id: 'rice', name: 'Rice', cost_price: '50000', stock_quantity: 10, item_type: 'PRODUCT', track_stock: true },
                    { id: 'delivery', name: 'Delivery', cost_price: null, stock_quantity: null, item_type: 'SERVICE', track_stock: false }],
    suppliers: [{ id: 's1', name: 'Mills Ltd', phone: '0803 123 4567', email: 'orders@mills.example' }],
  };
});

test('order helpers total, share and explain refusals', () => {
  expect(orderTotalKobo([{ quantity: 24, unit_cost: '1200.5' }, { quantity: 5, unit_cost: 50000 }])).toBe(2881200 + 25000000);
  expect(whatsappNumber('0803 123 4567')).toBe('2348031234567');
  expect(whatsappNumber('+234 803 123 4567')).toBe('2348031234567');
  expect(whatsappNumber('12345')).toBeNull();
  expect(orderText(order, 'Ada Provisions', 'Mills Ltd', [{ name: 'Beans', quantity: 24, unit_cost: '1200.5' }]))
    .toBe('Purchase order PO-0001 from Ada Provisions\nTo: Mills Ltd\n24 x Beans at ₦1,200.50\nTotal: ₦28,812.00\nPlease deliver by 2026-11-12.\nCall before delivery');
  expect(orderError({ message: 'ORDER_SENT' })).toBe('This order has been sent. Cancel it and make a new one to change it.');
  expect(orderError({ message: 'new row violates row-level security policy', code: '42501' })).toMatch(/plan may not include purchasing/);
  expect([isRouteAvailableInMode('/purchases', 'PRODUCT'), isRouteAvailableInMode('/purchases/x', 'SERVICE')]).toEqual([true, false]);
});

test('a draft order gets stocked products at their cost and is marked as sent', async () => {
  render(<PurchaseOrderPage />);
  expect(await screen.findByRole('heading', { name: 'PO-0001' })).toBeInTheDocument();
  expect(screen.getByText('₦28,812.00', { selector: 'tfoot td' })).toBeInTheDocument();
  const product = screen.getByLabelText('Product');
  expect(product).not.toHaveTextContent('Delivery');  // services are not ordered
  expect(product).not.toHaveTextContent('Beans');     // already on the order
  await userEvent.selectOptions(product, 'rice');
  expect(screen.getByLabelText('Unit cost (₦)')).toHaveValue('50000');
  await userEvent.clear(screen.getByLabelText('Quantity')); await userEvent.type(screen.getByLabelText('Quantity'), '5');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(mockDb.writes).toContainEqual({ table: 'purchase_order_lines', kind: 'insert',
    value: { business_id: 'b1', order_id: 'po1', item_id: 'rice', quantity: 5, unit_cost: '50000' } }));
  await userEvent.click(screen.getByRole('button', { name: 'Mark as sent' }));
  await waitFor(() => expect(mockDb.writes.at(-1)).toEqual({ table: 'purchase_orders', kind: 'update', value: { status: 'sent' } }));
});

test('a sent order is shared with the supplier and cancelled with a reason', async () => {
  mockDb.rows.purchase_orders = [{ ...order, status: 'sent', sent_at: '2026-11-07T09:00:00Z' }];
  render(<PurchaseOrderPage />);
  const whatsapp = await screen.findByRole('link', { name: 'Send on WhatsApp' });
  expect(whatsapp.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/2348031234567\?text=Purchase%20order%20PO-0001/);
  expect(screen.getByRole('link', { name: 'Email' }).getAttribute('href')).toMatch(/^mailto:orders%40mills\.example\?subject=Purchase%20order%20PO-0001/);
  expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
  await userEvent.type(screen.getByLabelText('Reason'), 'Found a cheaper supplier');
  await userEvent.click(screen.getAllByRole('button', { name: 'Cancel order' }).at(-1)!);
  await waitFor(() => expect(mockDb.writes.at(-1)).toEqual({ table: 'purchase_orders', kind: 'update', value: { status: 'cancelled', cancel_reason: 'Found a cheaper supplier' } }));
  expect(await screen.findByText('Order cancelled.')).toBeInTheDocument();
});

test('the list explains purchasing on the General plan and starts an order for a supplier', async () => {
  mockDb.allowed = false;
  const { unmount } = render(<PurchasesPage />);
  expect(await screen.findByText(/come with the Oga and Chairman plans/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New order' })).toBeDisabled();
  unmount();
  mockDb.allowed = true;
  const assign = jest.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  mockDb.reply = { data: [{ id: 'po2' }], error: null };
  render(<PurchasesPage />);
  expect(await screen.findByRole('link', { name: 'PO-0001' })).toHaveAttribute('href', '/purchases/po1');
  await userEvent.click(screen.getByRole('button', { name: 'New order' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start order' }));  // the only supplier is chosen
  await waitFor(() => expect(mockDb.writes.at(-1)).toEqual({ table: 'purchase_orders', kind: 'insert', value: { business_id: 'b1', supplier_id: 's1', expected_date: null, notes: '' } }));
  expect(assign).toHaveBeenCalledWith('/purchases/po2');
});
