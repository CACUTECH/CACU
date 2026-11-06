import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppointmentsPage from '@/app/appointments/page';
import POSPage from '@/app/pos/page';
import { billByInvoiceAction, getBookingBillAction, getBookingMoneyAction } from '@/app/appointments/actions';
import { getCheckoutOptionsAction, processCheckoutAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { receiptText } from '@/lib/checkout';
import { addDays, lagosInstant } from '@/lib/bookings';
import { lagosToday } from '@/lib/transfers';

jest.mock('@/app/appointments/actions', () => ({ getBookingMoneyAction: jest.fn(), getBookingBillAction: jest.fn(), billByInvoiceAction: jest.fn(),
  takeDepositAction: jest.fn(), closeBookingAction: jest.fn() }));
jest.mock('@/app/jobs/actions', () => ({ getJobMoneyAction: jest.fn() }));
jest.mock('@/app/pos/actions', () => ({ getCheckoutOptionsAction: jest.fn(), processCheckoutAction: jest.fn() }));
jest.mock('@/app/pos/shift-actions', () => ({ getShiftAction: jest.fn().mockResolvedValue({ success: true, data: null }) }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('b1') }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('booking=bk-1') }));
const mockToast = { toast: jest.fn() };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => mockToast }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const today = lagosToday(), tomorrow = addDays(today, 1);
const mockRows: Record<string, unknown[]> = {
  catalog_items: [{ id: 'braids', name: 'Braids', price: 15000, unit_price: 15000, duration: 45, type: 'SERVICE', status: 'active', quantity: 0 }],
  service_staff: [{ id: 'ada', name: 'Ada', is_active: true }], service_staff_services: [{ staff_id: 'ada', service_id: 'braids' }],
  service_staff_hours: [], service_staff_time_off: [], customers: [{ id: 'c1', name: 'Funmi' }], parked_sales: [],
  appointments: [{ id: 'bk-1', staff_id: 'ada', service_id: 'braids', scheduled_at: lagosInstant(tomorrow, '10:00'), ends_at: lagosInstant(tomorrow, '10:45'),
    duration_minutes: 45, title: 'Braids', status: 'completed', customer_id: null, customer_name: 'Kemi', customer_phone: null, notes: null, cancel_reason: null, bill_kind: null }],
};
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'order', 'limit', 'gte', 'lte', 'lt', 'eq']) chain[step] = () => chain;
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: mockRows[table] ?? [], error: null });
  return chain;
} }) }));

jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const settings = { free_cancel_hours: 24, late_deposit: 'keep', deposits_ready: true, rules: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (getBookingMoneyAction as jest.Mock).mockResolvedValue({ success: true, data: { settings, deposits: [] } });
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getCheckoutOptionsAction as jest.Mock).mockResolvedValue({ discount_cap: '5', allow_oversell: false, refund_threshold: null });
});

test('a completed booking is paid at the till or billed by invoice to a chosen customer', async () => {
  (billByInvoiceAction as jest.Mock).mockResolvedValue({ success: true, data: { appointment_id: 'bk-1', invoice_id: 'i1', invoice_number: 'BK-ABC',
    total: '15000.00', deposit_applied: '3000.00', outstanding: '12000.00' } });
  render(<AppointmentsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Next day' }));
  expect(await screen.findByRole('link', { name: 'Take payment' })).toHaveAttribute('href', '/pos?booking=bk-1');
  await userEvent.click(screen.getByRole('button', { name: 'Bill by invoice' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the customer to invoice');
  await userEvent.selectOptions(screen.getByLabelText('Customer'), 'c1');
  await userEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
  await waitFor(() => expect(billByInvoiceAction).toHaveBeenCalledWith('bk-1', { requestKey: expect.any(String), customerId: 'c1' }));
  expect(await screen.findByText('Invoice BK-ABC issued for ₦15,000.00. The ₦3,000.00 deposit was applied; ₦12,000.00 is still owed.')).toBeInTheDocument();
});

test('the till opened from a booking takes its deposit off what is due and sends the booking', async () => {
  (getBookingBillAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'bk-1', status: 'completed', customer_id: null, customer_name: 'Kemi',
    service_id: 'braids', service: 'Braids', price: '15000.00', bill_kind: null, bill_id: null, deposit: { amount: '3000.00', method: 'cash', status: 'held' } } });
  (processCheckoutAction as jest.Mock).mockResolvedValue({ success: true, saleId: 's1', status: 'completed', change: '0.00', invoiceNumber: null, shortfalls: [], paidNow: '12000.00' });
  window.history.replaceState(null, '', '/pos?booking=bk-1');
  render(<POSPage />);
  expect(await screen.findByText("Paying for Kemi's Braids.")).toBeInTheDocument();
  expect(screen.getByText('The ₦3,000.00 deposit paid earlier comes off the bill.')).toBeInTheDocument();
  expect(screen.getByText('₦12,000.00')).toBeInTheDocument();  // to pay
  await userEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }));
  await userEvent.click(screen.getByRole('radio', { name: 'On credit' }));
  expect(screen.getByRole('alert')).toHaveTextContent('paid in cash or by transfer');
  await userEvent.click(screen.getByRole('radio', { name: 'Cash' }));
  await userEvent.type(screen.getByLabelText('Cash received (₦, optional)'), '11000');
  expect(screen.getByRole('alert')).toHaveTextContent('less than the ₦12,000.00 due');
  await userEvent.clear(screen.getByLabelText('Cash received (₦, optional)'));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm & Record Sale' }));
  await waitFor(() => expect(processCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'bk-1', paymentMethod: 'Cash', totalAmount: 15000 })));
  expect(window.location.search).toBe('');
});

test('a receipt shows the deposit paid earlier and what was paid now', () => {
  const text = receiptText({ id: 's1', number: 'CS-1', date: '2026-11-09', status: 'completed', method: 'cash', subtotal: '15000.00', discount_total: '0.00',
    total: '15000.00', cash_received: null, change: null, transfer_amount: null, deposit_applied: '3000.00', paid_now: '12000.00',
    items: [{ name: 'Braids', quantity: 1, unit_price: '15000.00', discount: '0.00', total: '15000.00' }] }, 'Ada Salon');
  expect(text).toContain('Deposit paid earlier: ₦3000.00\nPaid now: ₦12000.00');
});
