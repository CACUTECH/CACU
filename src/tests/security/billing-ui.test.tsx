import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillingPage from '@/app/settings/billing/page';
import { getBillingAction, payRenewalAction, removeCardAction, schedulePlanAction, startCheckoutAction, verifyPaymentAction } from '@/app/settings/billing/actions';
import { useBusiness } from '@/components/business-provider';
import type { Plan } from '@/lib/billing';

jest.mock('@/app/settings/billing/actions', () => ({ getBillingAction: jest.fn(), payRenewalAction: jest.fn(), removeCardAction: jest.fn(), schedulePlanAction: jest.fn(), startCheckoutAction: jest.fn(), verifyPaymentAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
jest.mock('lucide-react', () => ({ Check: () => null, Loader2: () => null }));

const plan = (code: Plan['code'], name: string, monthly: number, annual: number | null, hybrid = false): Plan => ({ code, name, monthly_price_kobo: monthly,
  annual_price_kobo: annual, currency: 'NGN', entitlements: { 'users.max': 2, 'outlets.max': 1, 'catalog.max_items': 300, 'module.modes': hybrid ? ['PRODUCT', 'SERVICE', 'HYBRID'] : ['PRODUCT', 'SERVICE'] } });
const plans = [plan('BASE', 'General', 150000, null), plan('GROW', 'Oga', 600000, 6000000), plan('TOP', 'Chairman', 1500000, 15000000, true)];
const trial = { subscribed: true, plan: 'GROW', plan_name: 'Oga', status: 'trialing', billing_interval: 'monthly', current_period_end: '2026-11-16T10:00:00Z',
  grace_ends_at: null, writes_allowed: true, entitlements: {} };
const REFERENCE = 'CACU-SUB-' + 'b'.repeat(32);
const assign = jest.fn();
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/settings/billing');
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, search: '', pathname: '/settings/billing' } });
  (getBillingAction as jest.Mock).mockResolvedValue({ success: true, data: { plans, current: trial, history: [] } });
});
const as = (role: string) => (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'b1', userRole: role } });

test('the trial, prices before VAT and the yearly prices are shown', async () => {
  as('owner');
  render(<BillingPage />);
  expect(await screen.findByText('Oga Plan')).toBeInTheDocument();
  expect(screen.getByText('Free trial')).toBeInTheDocument();
  expect(screen.getByText(/ends on 16 Nov 2026/)).toBeInTheDocument();
  expect(screen.getByText('Prices exclude 7.5% VAT, added at checkout.')).toBeInTheDocument();
  expect(screen.getByText('₦15,000')).toBeInTheDocument();
  expect(screen.getByText('Products, services or Hybrid')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Yearly (2 months free)' }));
  expect(screen.getByText('₦150,000')).toBeInTheDocument();
  expect(screen.getByText('Monthly only')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose General' })).toBeDisabled();
});

test('choosing a plan opens Paystack, and a retry reuses the same request key', async () => {
  as('admin');
  (startCheckoutAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'Checkout could not start. Try again; you have not been charged.' })
    .mockResolvedValueOnce({ success: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } });
  render(<BillingPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Choose Chairman' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('you have not been charged');
  await userEvent.click(screen.getByRole('button', { name: 'Choose Chairman' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/abc'));
  const [first, second] = (startCheckoutAction as jest.Mock).mock.calls.map(call => call[0]);
  expect(first).toEqual({ request_key: expect.any(String), plan: 'TOP', interval: 'monthly' });
  expect(second.request_key).toBe(first.request_key);
});

test('editors and viewers see plans but cannot choose or see invoices', async () => {
  as('editor');
  render(<BillingPage />);
  expect(await screen.findAllByText('Only an Owner or Admin can change the plan.')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /Choose/ })).not.toBeInTheDocument();
  expect(getBillingAction).toHaveBeenCalledWith(false);
});

test('returning from Paystack verifies on the server before saying anything is paid', async () => {
  as('owner');
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, search: `?trxref=${REFERENCE}&reference=${REFERENCE}`, pathname: '/settings/billing' } });
  (verifyPaymentAction as jest.Mock).mockResolvedValue({ success: true, data: { outcome: 'activated' } });
  (getBillingAction as jest.Mock).mockResolvedValue({ success: true, data: { plans, current: { ...trial, plan: 'TOP', plan_name: 'Chairman', status: 'active' }, history: [
    { invoice: 'CACU-INV-000001', plan: 'TOP', billing_interval: 'monthly', subtotal_kobo: 1500000, vat_kobo: 112500, total_kobo: 1612500, status: 'paid', created_at: '', paid_at: '', receipt: 'CACU-RCT-000001' }] } });
  render(<BillingPage />);
  expect(await screen.findByRole('status')).toHaveTextContent('Payment confirmed. Your plan is active.');
  expect(verifyPaymentAction).toHaveBeenCalledWith(REFERENCE);
  expect(await screen.findByText('CACU-RCT-000001')).toBeInTheDocument();
  expect(screen.getByText('₦16,125')).toBeInTheDocument();
  expect(screen.getByText('Current plan')).toBeDisabled();
});

test('a failed read says so instead of showing no plan', async () => {
  as('owner');
  (getBillingAction as jest.Mock).mockResolvedValue({ success: false, error: 'Billing details are unavailable. Refresh and try again.' });
  render(<BillingPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Billing details are unavailable');
  expect(screen.queryByText('No plan yet')).not.toBeInTheDocument();
});

test('an active plan offers an upgrade and schedules a smaller plan with a warning about limits', async () => {
  as('owner');
  const active = { ...trial, status: 'active', current_period_end: '2026-12-02T10:00:00Z', scheduled_plan: null };
  (getBillingAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { plans, current: active, history: [] } })
    .mockResolvedValue({ success: true, data: { plans, current: { ...active, scheduled_plan: 'BASE' }, history: [] } });
  (schedulePlanAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { scheduled_plan: 'BASE', effective_at: active.current_period_end,
    over_limits: { 'users.max': { used: 4, limit: 2 } } } });
  render(<BillingPage />);
  expect(await screen.findByRole('button', { name: 'Upgrade to Chairman' })).toBeEnabled();
  expect(screen.getByText('You pay the difference for the days left in this period, plus VAT.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Move to General on 2 Dec 2026' }));
  expect(schedulePlanAction).toHaveBeenCalledWith('BASE');
  expect(await screen.findByText(/You have 4 users; the General Plan allows 2/)).toBeInTheDocument();
  expect(await screen.findByText('Paid until 2 Dec 2026. You move to the General Plan then.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Keep my current plan' })).toBeEnabled();
  expect(startCheckoutAction).not.toHaveBeenCalled();
});

test('a declined renewal offers to pay now, and the saved card can be removed', async () => {
  as('owner');
  const active = { ...trial, status: 'active', current_period_end: '2026-12-02T10:00:00Z', scheduled_plan: null,
    card: { card_type: 'visa', bank: null, last4: '4081', exp_month: '12', exp_year: '2030' },
    renewal: { invoice: 'CACU-INV-000002', plan: 'GROW', billing_interval: 'monthly', total_kobo: 645000, due_at: '2026-12-02T10:00:00Z', last_failure: 'Insufficient Funds' } };
  (getBillingAction as jest.Mock).mockResolvedValue({ success: true, data: { plans, current: active, history: [] } });
  (payRenewalAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { authorization_url: 'https://checkout.paystack.com/r' } });
  (removeCardAction as jest.Mock).mockResolvedValueOnce({ success: true, data: null });
  render(<BillingPage />);
  expect(await screen.findByText(/did not go through: Insufficient Funds/)).toBeInTheDocument();
  expect(screen.getByText('Saved for renewals: Visa ending 4081, expires 12/2030')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove card' }));
  expect(await screen.findByText('Card removed. Renewals will need you to pay from this page.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Pay ₦6,450 now' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/r'));
});

test('editors never see the card or the renewal', async () => {
  as('editor');
  const active = { ...trial, status: 'active', card: { card_type: 'visa', bank: null, last4: '4081', exp_month: '12', exp_year: '2030' },
    renewal: { invoice: 'CACU-INV-000002', plan: 'GROW', billing_interval: 'monthly', total_kobo: 645000, due_at: '2026-12-02T10:00:00Z', last_failure: null } };
  (getBillingAction as jest.Mock).mockResolvedValue({ success: true, data: { plans, current: active, history: null } });
  render(<BillingPage />);
  expect(await screen.findByText('Oga Plan')).toBeInTheDocument();
  expect(screen.queryByText(/4081/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Renewal of/)).not.toBeInTheDocument();
});
