import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayPage from '@/app/pay/[token]/page';
import OnlinePaymentsPage from '@/app/settings/online-payments/page';
import { PayLinkDialog } from '@/components/pay-link-dialog';
import { paySummaryAction, startPayAction, verifyPayAction } from '@/app/pay/actions';
import { checkPaystackAction, connectPaystackAction, onlinePaymentsAction } from '@/app/settings/online-payments/actions';
import { revokePaymentLinkAction, sharePaymentLinkAction } from '@/app/invoices/payment-link-actions';
import { payAmountError, type OnlineOverview, type PaySummary } from '@/lib/online-payments';

jest.mock('@/app/pay/actions', () => ({ paySummaryAction: jest.fn(), startPayAction: jest.fn(), verifyPayAction: jest.fn() }));
jest.mock('@/app/settings/online-payments/actions', () => ({ onlinePaymentsAction: jest.fn(), connectPaystackAction: jest.fn(),
  disconnectPaystackAction: jest.fn(), checkPaystackAction: jest.fn() }));
jest.mock('@/app/invoices/payment-link-actions', () => ({ sharePaymentLinkAction: jest.fn(), revokePaymentLinkAction: jest.fn() }));
let search = new URLSearchParams();
jest.mock('next/navigation', () => ({ useParams: () => ({ token: 'a'.repeat(64) }), useSearchParams: () => search }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.setTimeout(20000);
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'key-1' });
const token = 'a'.repeat(64);

const summary: PaySummary = { business: { name: 'Ada Provisions', address: '12 Market Road, Ikorodu', phone: null }, invoice_number: 'INV-7',
  issue_date: '2026-11-01', due_date: '2026-11-15', customer_name: 'Bola', total: '65000.00', outstanding: '25000.00', payable: '25000.00',
  needs_email: true, minimum: '100.00' };

beforeEach(() => { jest.clearAllMocks(); search = new URLSearchParams(); (paySummaryAction as jest.Mock).mockResolvedValue({ success: true, data: summary }); });

test('the amount a customer may pay is above zero, within what is owed, and at least the minimum unless it clears the invoice', () => {
  expect(payAmountError('25000', summary)).toBeNull();
  expect(payAmountError('30000', summary)).toBe('At most ₦25,000.00 is still owed.');
  expect(payAmountError('50', summary)).toBe('Pay at least ₦100.00.');
  expect(payAmountError('50', { payable: '50.00', minimum: '100.00' })).toBeNull();
  expect(payAmountError('abc', summary)).toMatch('Enter an amount in naira');
});

test('a customer sees what is owed, pays part, and is sent to Paystack', async () => {
  (startPayAction as jest.Mock).mockResolvedValue({ success: false, error: 'Paystack could not start the payment. Try again shortly.' });
  render(<PayPage />);
  expect(await screen.findByRole('heading', { name: 'Ada Provisions' })).toBeInTheDocument();
  expect(screen.getByText('Invoice INV-7 for Bola')).toBeInTheDocument();
  expect(screen.getByLabelText('Amount to pay (NGN)')).toHaveValue('25000.00');
  await userEvent.clear(screen.getByLabelText('Amount to pay (NGN)'));
  await userEvent.type(screen.getByLabelText('Amount to pay (NGN)'), '30000');
  await userEvent.click(screen.getByRole('button', { name: 'Pay with Paystack' }));
  expect(screen.getByRole('alert')).toHaveTextContent('At most ₦25,000.00 is still owed.');
  await userEvent.clear(screen.getByLabelText('Amount to pay (NGN)'));
  await userEvent.type(screen.getByLabelText('Amount to pay (NGN)'), '10000');
  await userEvent.click(screen.getByRole('button', { name: 'Pay with Paystack' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your email address');
  expect(startPayAction).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Your email (for the Paystack receipt)'), 'bola@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Pay with Paystack' }));
  await waitFor(() => expect(startPayAction).toHaveBeenCalledWith(token, '10000', 'bola@example.com'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Paystack could not start the payment');
});

test('coming back from Paystack shows paid only once Paystack confirms it', async () => {
  search = new URLSearchParams({ reference: 'CACU-PAY-' + 'b'.repeat(32) });
  (verifyPayAction as jest.Mock).mockResolvedValue({ success: true, data: { status: 'posted', paid: '25000.00', summary: { ...summary, outstanding: '0.00', payable: '0.00' } } });
  render(<PayPage />);
  expect(await screen.findByText(/Payment of ₦25,000.00 received/)).toBeInTheDocument();
  expect(verifyPayAction).toHaveBeenCalledWith(token, 'CACU-PAY-' + 'b'.repeat(32));
  expect(screen.getByText('Nothing is left to pay on this invoice.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pay with Paystack' })).not.toBeInTheDocument();
});

test('a withdrawn link shows nothing about the invoice', async () => {
  (paySummaryAction as jest.Mock).mockResolvedValue({ success: false, error: 'This pay link does not work.', gone: true });
  render(<PayPage />);
  expect(await screen.findByRole('heading', { name: 'Pay link not available' })).toBeInTheDocument();
  expect(screen.queryByText(/Ada Provisions/)).not.toBeInTheDocument();
});

const banks = [{ id: 'gtb', name: 'GTBank' }];
const empty: OnlineOverview = { settings: { connected: false, can_manage: true, banks }, awaiting_payout: '0.00', payments: [], payouts: [] };

test('an owner connects Paystack with the secret key and the payout bank, then sees the webhook address', async () => {
  (onlinePaymentsAction as jest.Mock).mockResolvedValueOnce({ success: true, data: empty }).mockResolvedValue({ success: true, data: {
    settings: { connected: true, can_manage: true, banks, mode: 'live', key_hint: 'sk_live_...9xYz', settlement_bank_account_id: 'gtb',
      webhook_url: 'https://api.example.com/api/v1/webhooks/paystack/' + 'c'.repeat(64) },
    awaiting_payout: '40000.00', payouts: [{ id: '7003', settled_on: '2026-11-09', gross: '30000.00', fee: '550.00', net: '29450.00', reported_net: '49150.00',
      unmatched: '19700.00', status: 'needs_review', note: '₦19,700.00 in this payout is not from a CACU pay link.' }],
    payments: [{ reference: 'r1', status: 'posted', amount: '40000.00', paid: '40000.00', fee: '700.00', paid_at: null, channel: 'card', review_reason: null,
      settled: false, invoice_number: 'INV-7', customer: 'Bola', started_at: '2026-11-09T09:00:00Z' }] } });
  (connectPaystackAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  (checkPaystackAction as jest.Mock).mockResolvedValue({ success: true, data: { checked: 1, posted: 1, payouts: 0, payouts_for_review: 1 } });
  render(<OnlinePaymentsPage />);
  await userEvent.type(await screen.findByLabelText('Paystack secret key'), 'pk_live_wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Connect Paystack' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Paste your Paystack secret key');
  await userEvent.clear(screen.getByLabelText('Paystack secret key'));
  await userEvent.type(screen.getByLabelText('Paystack secret key'), 'sk_live_' + 'Q'.repeat(30));
  await userEvent.click(screen.getByRole('button', { name: 'Connect Paystack' }));
  await waitFor(() => expect(connectPaystackAction).toHaveBeenCalledWith({ request_key: 'key-1', secret_key: 'sk_live_' + 'Q'.repeat(30), settlement_bank_account_id: 'gtb' }));
  expect(await screen.findByLabelText('Webhook address')).toHaveTextContent('/api/v1/webhooks/paystack/' + 'c'.repeat(64));
  expect(screen.getByText(/Key sk_live_\.\.\.9xYz\. Payouts go to GTBank/)).toBeInTheDocument();
  expect(screen.getByLabelText('Paystack secret key')).toHaveValue('');  // the key is not kept on screen
  expect(screen.getByText('Not paid out yet')).toBeInTheDocument();
  expect(screen.getByText(/not from a CACU pay link/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check Paystack now' }));
  expect(await screen.findByText(/1 payment confirmed, 0 payouts matched to the bank, 1 payout to review/)).toBeInTheDocument();
});

test('only an Owner or Admin sees the connect form', async () => {
  (onlinePaymentsAction as jest.Mock).mockResolvedValue({ success: true, data: { ...empty, settings: { connected: false, can_manage: false, banks: [] } } });
  render(<OnlinePaymentsPage />);
  expect(await screen.findByText('Only an Owner or Admin can connect Paystack.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Paystack secret key')).not.toBeInTheDocument();
});

test('staff share a pay link, and can withdraw it', async () => {
  (sharePaymentLinkAction as jest.Mock).mockResolvedValue({ success: true, data: { token, invoice_number: 'INV-7', outstanding: '25000.00', url: `https://app.example.com/pay/${token}` } });
  (revokePaymentLinkAction as jest.Mock).mockResolvedValue({ success: true, data: { revoked: true } });
  render(<PayLinkDialog invoice={{ id: 'i7', invoice_number: 'INV-7' }} onClose={jest.fn()} />);
  expect(await screen.findByLabelText('Link for the customer')).toHaveTextContent(`https://app.example.com/pay/${token}`);
  expect(sharePaymentLinkAction).toHaveBeenCalledWith('i7', 'key-1');
  expect(screen.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href')).toContain(encodeURIComponent('Please pay invoice INV-7 (₦25,000.00)'));
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw link' }));
  expect(await screen.findByText('The link was withdrawn. It no longer works.')).toBeInTheDocument();
  expect(revokePaymentLinkAction).toHaveBeenCalledWith('i7');
});
