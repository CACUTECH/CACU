import { highlights, isCheckoutUrl, naira, nextStep, price, returnedReference, usageLines, type Plan } from '@/lib/billing';
import { getBillingAction, startCheckoutAction, verifyPaymentAction } from '@/app/settings/billing/actions';
import { AccountingRequestError, accountingRequest } from '@/lib/accounting-client';
import { createClient } from '@/lib/supabase/server';

jest.mock('@/lib/accounting-client', () => {
  class AccountingRequestError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
  return { AccountingRequestError, accountingRequest: jest.fn() };
});
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('active-business') }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const REFERENCE = 'CACU-SUB-' + 'a'.repeat(32);
const oga: Plan = { code: 'GROW', name: 'Oga', monthly_price_kobo: 600000, annual_price_kobo: 6000000, currency: 'NGN',
  entitlements: { 'users.max': 5, 'outlets.max': 2, 'catalog.max_items': 3000, 'module.modes': ['PRODUCT', 'SERVICE'], 'module.purchasing': true, 'reports.advanced': true, 'ai.queries_per_month': 100 } };

test('prices show naira without inventing kobo', () => {
  expect([naira(150000), naira(161250), naira(15000000)]).toEqual(['₦1,500', '₦1,612.50', '₦150,000']);
  expect([price(oga, 'monthly'), price({ ...oga, annual_price_kobo: null }, 'annual')]).toEqual([600000, null]);
});

test('plan highlights read like an owner would compare them', () => {
  expect(highlights(oga.entitlements)).toEqual(['5 users', '2 outlets', '3,000 catalogue items', 'Products or services',
    'Purchasing and supplier bills', 'Cash flow and ageing reports', '100 AI questions a month']);
  expect(highlights({ 'users.max': 1, 'outlets.max': 1, 'catalog.max_items': null, 'module.modes': ['PRODUCT', 'SERVICE', 'HYBRID'], 'ai.queries_per_month': 0 }))
    .toEqual(['1 user', '1 outlet', 'Unlimited catalogue items', 'Products, services or Hybrid']);
});

test('usage shows each counted limit and flags a full one', () => {
  const current = { subscribed: true as const, plan: 'BASE' as const, plan_name: 'General', status: 'active' as const, billing_interval: 'monthly' as const,
    current_period_end: null, grace_ends_at: null, writes_allowed: true,
    entitlements: { 'users.max': 2, 'outlets.max': 1, 'catalog.max_items': null }, usage: { 'users.max': 2, 'outlets.max': 0, 'catalog.max_items': 1250 } };
  expect(usageLines(current).map(({ label, text, full }) => [label, text, full])).toEqual([
    ['Users', '2 of 2', true], ['Outlets', '0 of 1', false], ['Catalogue items', '1,250 (unlimited)', false]]);
  expect(usageLines({ ...current, usage: undefined })).toEqual([]);
});

test('next step explains the trial, payment due and read-only states', () => {
  const base = { subscribed: true as const, plan: 'GROW' as const, plan_name: 'Oga', billing_interval: 'monthly' as const, writes_allowed: true, entitlements: {},
    current_period_end: '2026-11-16T10:00:00Z', grace_ends_at: '2026-11-23T10:00:00Z' };
  expect(nextStep({ ...base, status: 'trialing' })).toBe('Your free trial of the Oga Plan ends on 16 Nov 2026. Choose a plan to keep going; otherwise you move to the General Plan.');
  expect(nextStep({ ...base, status: 'incomplete' })).toBe('Pay by 23 Nov 2026 to keep full access. Nothing is deleted if you pay late.');
  expect(nextStep({ ...base, status: 'suspended' })).toMatch(/read-only until you pay/);
});

test('only CACU subscription references and Paystack checkout links are trusted', () => {
  expect(returnedReference(new URLSearchParams(`trxref=${REFERENCE}&reference=${REFERENCE}`))).toBe(REFERENCE);
  expect(returnedReference(new URLSearchParams('reference=tenant-sale-1'))).toBeNull();
  expect(isCheckoutUrl('https://checkout.paystack.com/abc')).toBe(true);
  expect(['http://checkout.paystack.com/abc', 'https://checkout.paystack.com.evil.example/abc', 'javascript:alert(1)', 42].some(isCheckoutUrl)).toBe(false);
});

function client(results: Record<string, { data: unknown; error: unknown }>) {
  const rpc = jest.fn((name: string) => Promise.resolve(results[name]));
  (createClient as jest.Mock).mockResolvedValue({ rpc });
  return rpc;
}

test('members other than Owners and Admins never ask for invoices', async () => {
  const rpc = client({ billing_plans: { data: [oga], error: null }, business_plan: { data: { subscribed: false }, error: null } });
  await expect(getBillingAction(false)).resolves.toEqual({ success: true, data: { plans: [oga], current: { subscribed: false }, history: null } });
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['billing_plans', 'business_plan']);
  expect(rpc).toHaveBeenCalledWith('business_plan', { p_business_id: 'active-business' });
});

test('a failed read is reported, never shown as no plan', async () => {
  client({ billing_plans: { data: [oga], error: null }, business_plan: { data: null, error: { message: 'private detail' } }, business_billing_history: { data: [], error: null } });
  await expect(getBillingAction(true)).resolves.toEqual({ success: false, error: 'Billing details are unavailable. Refresh and try again.' });
});

test('checkout returns only a Paystack link and passes the request key through', async () => {
  const input = { request_key: 'key-1', plan: 'GROW' as const, interval: 'annual' as const };
  (accountingRequest as jest.Mock).mockResolvedValueOnce({ authorization_url: 'https://checkout.paystack.com/x', reference: REFERENCE });
  await expect(startCheckoutAction(input)).resolves.toMatchObject({ success: true });
  expect(accountingRequest).toHaveBeenCalledWith('billing/checkout', { method: 'POST', body: input });
  (accountingRequest as jest.Mock).mockResolvedValueOnce({ authorization_url: 'https://evil.example/pay' });
  await expect(startCheckoutAction(input)).resolves.toEqual({ success: false, error: 'Checkout could not start. Try again; you have not been charged.' });
  (accountingRequest as jest.Mock).mockRejectedValueOnce(new AccountingRequestError('Hybrid mode is on the Chairman Plan only. Switch to Products or Services first.', 403));
  await expect(startCheckoutAction(input)).resolves.toEqual({ success: false, error: 'Hybrid mode is on the Chairman Plan only. Switch to Products or Services first.' });
});

test('server failures while verifying never claim the payment failed', async () => {
  (accountingRequest as jest.Mock).mockRejectedValueOnce(new AccountingRequestError('Accounting request failed (502)', 502));
  await expect(verifyPaymentAction(REFERENCE)).resolves.toEqual({ success: false,
    error: 'We could not confirm the payment yet. Refresh in a minute; it will show once Paystack confirms it.' });
});
