import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingBanner } from '@/components/billing-banner';
import { useSubscription } from '@/components/subscription-guard';
import { useBusiness } from '@/components/business-provider';
import { payRenewalAction } from '@/app/settings/billing/actions';

let mockPathname = '/invoices';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/components/subscription-guard', () => ({ useSubscription: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
jest.mock('@/app/settings/billing/actions', () => ({ payRenewalAction: jest.fn() }));

const assign = jest.fn();
const graceWithRenewal = { subscribed: true, plan: 'GROW', plan_name: 'Oga', status: 'past_due', billing_interval: 'monthly',
  current_period_end: '2026-11-16T10:00:00Z', grace_ends_at: '2026-11-23T10:00:00Z', writes_allowed: true, entitlements: {},
  renewal: { invoice: 'CACU-INV-000009', plan: 'GROW', billing_interval: 'monthly', total_kobo: 645000, due_at: '2026-11-16T10:00:00Z', last_failure: null } };
beforeEach(() => {
  jest.clearAllMocks(); mockPathname = '/invoices';
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  (useSubscription as jest.Mock).mockReturnValue({ plan: graceWithRenewal });
});
const as = (role: string) => (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'b1', userRole: role } });

test('an owner in grace pays the renewal in one tap', async () => {
  as('owner');
  (payRenewalAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { authorization_url: 'https://checkout.paystack.com/r' } });
  render(<BillingBanner />);
  expect(screen.getByRole('status')).toHaveTextContent('Payment due. Pay by 23 Nov 2026 to keep full access.');
  await userEvent.click(screen.getByRole('button', { name: 'Pay now' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/r'));
});

test('other members are told who can pay, and the banner stays off the billing page', () => {
  as('editor');
  const { unmount } = render(<BillingBanner />);
  expect(screen.getByRole('status')).toHaveTextContent('Ask the business owner to pay.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  unmount();
  mockPathname = '/settings/billing';
  render(<BillingBanner />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('without an open renewal, the owner is sent to Billing to choose a plan', () => {
  as('admin');
  (useSubscription as jest.Mock).mockReturnValue({ plan: { ...graceWithRenewal, status: 'trialing', current_period_end: new Date(Date.now() + 86_400_000).toISOString(), renewal: null } });
  render(<BillingBanner />);
  expect(screen.getByRole('link', { name: 'Choose a plan' })).toHaveAttribute('href', '/settings/billing');
});
