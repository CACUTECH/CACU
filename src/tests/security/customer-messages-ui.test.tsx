import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareReceiptDialog } from '@/components/share-receipt-dialog';
import PublicReceiptPage from '@/app/r/[token]/page';
import NotificationsPage from '@/app/settings/notifications/page';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }) }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', name: 'Ada Provisions', userRole: 'owner' } }) }));
const token = 'a'.repeat(64);
jest.mock('next/navigation', () => ({ useParams: () => ({ token: 'a'.repeat(64) }) }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const texts = { limit: 20, used: 20, remaining: 0, resets_at: '2026-12-01T00:00:00+01:00' };

beforeEach(() => mockRpc.mockReset());

test('a receipt goes to the customer, and past the text allowance it says it went by email', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'PHONE_INVALID' } })
    .mockResolvedValueOnce({ data: { token, email: 'queued', text: 'allowance_used', texts }, error: null });
  render(<ShareReceiptDialog businessId="b1" saleId="s1" open onClose={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Get link' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Customer's email (optional)"), 'ada@example.com');
  await userEvent.type(screen.getByLabelText("Customer's phone (optional)"), '123');
  await userEvent.click(screen.getByRole('button', { name: 'Send receipt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a Nigerian mobile number');
  await userEvent.clear(screen.getByLabelText("Customer's phone (optional)")); await userEvent.type(screen.getByLabelText("Customer's phone (optional)"), '08031234567');
  await userEvent.click(screen.getByRole('button', { name: 'Send receipt' }));
  expect(await screen.findByText(/This month's 20 texts are used, so no text was sent; it went by email instead/)).toBeInTheDocument();
  expect(screen.getByText(`http://localhost/r/${token}`)).toBeInTheDocument();
  expect(mockRpc).toHaveBeenLastCalledWith('share_receipt', { p_business_id: 'b1', p_sale_id: 's1', p_request_key: expect.any(String), p_email: 'ada@example.com', p_phone: '08031234567' });
  mockRpc.mockResolvedValueOnce({ data: true, error: null });
  await userEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
  expect(await screen.findByText(/The link no longer works/)).toBeInTheDocument();
});

test('a receipt link shows the receipt without an account, and a withdrawn link says so', async () => {
  mockRpc.mockResolvedValueOnce({ data: { business: { name: 'Ada Provisions', address: 'Ikorodu', phone: null }, number: 'POS-0007', date: '2026-11-07',
    status: 'completed', method: 'cash', subtotal: 3000, discount_total: 0, total: 3000, transfer_amount: null, cash_received: 5000, change: 2000,
    refunded_total: 0, deposit_applied: 0, items: [{ name: 'Beans', quantity: 2, unit_price: 1500, discount: 0, total: 3000 }] }, error: null });
  const { unmount } = render(<PublicReceiptPage />);
  expect(await screen.findByRole('heading', { name: 'Ada Provisions' })).toBeInTheDocument();
  expect(screen.getByText('2 x Beans')).toBeInTheDocument();
  expect(mockRpc).toHaveBeenCalledWith('public_receipt', { p_token: token });
  unmount();
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  render(<PublicReceiptPage />);
  expect(await screen.findByRole('heading', { name: 'Receipt not available' })).toBeInTheDocument();
});

test('the notifications page turns reminders on and shows the month’s texts and masked history', async () => {
  const overview = { invoice_reminders: false, booking_reminders: false, can_edit: true, booking_allowed: true, texts: { ...texts, used: 3 },
    recent: [{ kind: 'receipt', channel: 'sms', to: '0803***4567', status: 'sent', created_at: '2026-11-07T10:00:00Z' }] };
  mockRpc.mockResolvedValueOnce({ data: overview, error: null }).mockResolvedValueOnce({ data: { ...overview, invoice_reminders: true }, error: null });
  render(<NotificationsPage />);
  expect(await screen.findByText('Receipt by text to 0803***4567')).toBeInTheDocument();
  expect(screen.getByText('of 20 used')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /Overdue invoice reminders/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mockRpc).toHaveBeenLastCalledWith('save_notification_settings', { p_business_id: 'b1', p_invoice_reminders: true, p_booking_reminders: false }));
  expect(await screen.findByText('Saved.')).toBeInTheDocument();
});
