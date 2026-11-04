import { bannerFor, cardLine, quoteLine, highlights, isCheckoutUrl, naira, nextStep, overLimitNotes, planAction, price, renewalLine, returnedReference, usageLines, type CurrentPlan, type Plan } from '@/lib/billing';
import { getBillingAction, quoteAction, payRenewalAction, removeCardAction, schedulePlanAction, startCheckoutAction, verifyPaymentAction } from '@/app/settings/billing/actions';
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
  expect(highlights({ 'users.max': 50, 'outlets.max': 20, 'catalog.max_items': null, 'module.modes': ['PRODUCT', 'SERVICE', 'HYBRID'], 'ai.queries_per_month': null }))
    .toEqual(['50 users', '20 outlets', 'Unlimited catalogue items', 'Products, services or Hybrid', 'Unlimited AI questions']);
});

test('usage shows each counted limit and flags a full one', () => {
  const current = { subscribed: true as const, plan: 'BASE' as const, plan_name: 'General', status: 'active' as const, billing_interval: 'monthly' as const,
    current_period_end: null, grace_ends_at: null, writes_allowed: true,
    entitlements: { 'users.max': 2, 'outlets.max': 1, 'catalog.max_items': null }, usage: { 'users.max': 2, 'outlets.max': 0, 'catalog.max_items': 1250 } };
  expect(usageLines(current).map(({ label, text, full }) => [label, text, full])).toEqual([
    ['Users', '2 of 2', true], ['Outlets', '0 of 1', false], ['Catalogue items', '1,250 (unlimited)', false]]);
  expect(usageLines({ ...current, usage: undefined })).toEqual([]);
  const general = { ...current, entitlements: { ...current.entitlements, 'ai.queries_per_month': 0 }, usage: { ...current.usage, 'ai.queries_per_month': 0 } };
  expect(usageLines(general).at(-1)).toEqual({ key: 'ai.queries_per_month', label: 'AI questions this month', text: 'Not on this plan', full: false });
  const oga = { ...current, entitlements: { ...current.entitlements, 'ai.queries_per_month': 100 }, usage: { ...current.usage, 'ai.queries_per_month': 100 } };
  expect(usageLines(oga).at(-1)).toMatchObject({ text: '100 of 100', full: true });
});

test('an active plan upgrades on its interval, schedules smaller plans and can cancel the schedule', () => {
  const general: Plan = { ...oga, code: 'BASE', name: 'General', annual_price_kobo: null };
  const chairman: Plan = { ...oga, code: 'TOP', name: 'Chairman' };
  const current = { subscribed: true as const, plan: 'GROW' as const, plan_name: 'Oga', status: 'active' as const, billing_interval: 'monthly' as const,
    current_period_end: '2026-12-02T10:00:00Z', grace_ends_at: null, writes_allowed: true, entitlements: {}, scheduled_plan: null };
  expect(planAction(current, chairman, 'monthly')).toMatchObject({ kind: 'upgrade', label: 'Upgrade to Chairman' });
  expect(planAction(current, chairman, 'annual')).toMatchObject({ kind: 'upgrade', label: 'Upgrade to Chairman yearly' });
  expect(planAction(current, oga, 'annual')).toMatchObject({ kind: 'upgrade', label: 'Switch to yearly' });
  expect(planAction(current, oga, 'monthly')).toEqual({ kind: 'current', label: 'Current plan' });
  expect(planAction(current, general, 'monthly')).toMatchObject({ kind: 'schedule', label: 'Move to General on 2 Dec 2026' });
  expect(planAction({ ...current, scheduled_plan: 'BASE' }, general, 'monthly')).toMatchObject({ kind: 'cancel', note: 'Move to General on 2 Dec 2026 is scheduled.' });
  expect(nextStep({ ...current, scheduled_plan: 'BASE' })).toBe('Paid until 2 Dec 2026. You move to the General Plan then.');
  const trial: CurrentPlan = { ...current, status: 'trialing' };
  expect([planAction(trial, general, 'monthly'), planAction(trial, general, 'annual')]).toEqual([
    { kind: 'checkout', label: 'Choose General' }, { kind: 'none', label: 'Choose General' }]);
});

test('a yearly plan switches to monthly at the end of the year, and the quote shows credit and VAT (SUB-07, SUB-R05)', () => {
  const chairman: Plan = { ...oga, code: 'TOP', name: 'Chairman' };
  const yearly = { subscribed: true as const, plan: 'GROW' as const, plan_name: 'Oga', status: 'active' as const, billing_interval: 'annual' as const,
    current_period_end: '2027-11-02T10:00:00Z', grace_ends_at: null, writes_allowed: true, entitlements: {}, scheduled_plan: null, scheduled_interval: null };
  expect(planAction(yearly, oga, 'annual')).toEqual({ kind: 'current', label: 'Current plan' });
  expect(planAction(yearly, oga, 'monthly')).toMatchObject({ kind: 'schedule', label: 'Switch to monthly on 2 Nov 2027' });
  expect(planAction(yearly, chairman, 'monthly')).toEqual({ kind: 'none', label: 'Available when your year ends' });
  expect(planAction({ ...yearly, scheduled_interval: 'monthly' }, oga, 'monthly')).toMatchObject({ kind: 'cancel', label: 'Keep my current plan' });
  expect(nextStep({ ...yearly, scheduled_plan: 'BASE', scheduled_interval: 'monthly' }))
    .toBe('Paid until 2 Nov 2027. You move to the General Plan and switch to monthly billing then.');
  expect(quoteLine({ kind: 'upgrade', subtotal_kobo: 5600000, vat_kobo: 420000, total_kobo: 6020000, credit_kobo: 400000, period_end: null }))
    .toBe('Pay ₦60,200 now: ₦56,000 + ₦4,200 VAT, after ₦4,000 for your unused days.');
  expect(quoteLine({ kind: 'upgrade', subtotal_kobo: 600000, vat_kobo: 45000, total_kobo: 645000, credit_kobo: null, period_end: null }))
    .toBe('Pay ₦6,450 now: ₦6,000 + ₦450 VAT.');
});

test('a scheduled downgrade explains what is over the new limits', () => {
  expect(overLimitNotes({ scheduled_plan: 'BASE', effective_at: null, over_limits: { 'outlets.max': { used: 3, limit: 1 } } })).toEqual([
    "You have 3 outlets; the General Plan allows 1. Nothing is removed, but you can't add more until you're under the limit."]);
  expect(overLimitNotes({ scheduled_plan: null, effective_at: null, over_limits: {} })).toEqual([]);
});

test('scheduling goes to the billing API and reports refusals in its words', async () => {
  (accountingRequest as jest.Mock).mockResolvedValueOnce({ scheduled_plan: 'BASE', effective_at: null, over_limits: {} });
  await expect(schedulePlanAction('BASE')).resolves.toMatchObject({ success: true });
  expect(accountingRequest).toHaveBeenCalledWith('billing/schedule', { method: 'POST', body: { plan: 'BASE' } });
  (accountingRequest as jest.Mock).mockRejectedValueOnce(new AccountingRequestError('A move to a bigger plan is paid through checkout', 409));
  await expect(schedulePlanAction('TOP')).resolves.toEqual({ success: false, error: 'A move to a bigger plan is paid through checkout' });
});

test('renewals say what is due, how it will be paid and why a card failed', () => {
  const card = { card_type: 'visa ', bank: 'TEST BANK', last4: '4081', exp_month: '12', exp_year: '2030' };
  const renewal = { invoice: 'CACU-INV-000002', plan: 'GROW' as const, billing_interval: 'monthly' as const, total_kobo: 645000, due_at: '2026-12-02T10:00:00Z', last_failure: null };
  expect(cardLine(card)).toBe('Visa ending 4081, expires 12/2030');
  expect(renewalLine(renewal, card)).toBe("Renewal of ₦6,450 (Oga Plan, VAT included) is due on 2 Dec 2026. We'll charge your Visa ending 4081, expires 12/2030.");
  expect(renewalLine(renewal, null)).toBe('Renewal of ₦6,450 (Oga Plan, VAT included) is due on 2 Dec 2026. Pay now, or your plan stops when the period ends.');
  expect(renewalLine({ ...renewal, last_failure: 'Insufficient Funds' }, card))
    .toBe('Your card payment of ₦6,450 (Oga Plan, VAT included) did not go through: Insufficient Funds. Pay now to keep full access.');
});

test('paying a renewal accepts only a Paystack link, and removing the card goes through the database', async () => {
  (accountingRequest as jest.Mock).mockResolvedValueOnce({ authorization_url: 'https://checkout.paystack.com/r' });
  await expect(payRenewalAction()).resolves.toMatchObject({ success: true });
  expect(accountingRequest).toHaveBeenCalledWith('billing/renewal', { method: 'POST', body: {} });
  (accountingRequest as jest.Mock).mockResolvedValueOnce({ authorization_url: 'https://evil.example/r' });
  await expect(payRenewalAction()).resolves.toMatchObject({ success: false });
  const rpc = client({ remove_payment_method: { data: null, error: null } });
  await expect(removeCardAction()).resolves.toEqual({ success: true, data: null });
  expect(rpc).toHaveBeenCalledWith('remove_payment_method', { p_business_id: 'active-business' });
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

test('quotes come from the database for the active business and refusals read in plain words', async () => {
  const rpc = client({ billing_quote: { data: { kind: 'upgrade', subtotal_kobo: 1, vat_kobo: 0, total_kobo: 1, credit_kobo: null, period_end: null }, error: null } });
  await expect(quoteAction('TOP', 'annual')).resolves.toMatchObject({ success: true });
  expect(rpc).toHaveBeenCalledWith('billing_quote', { p_business_id: 'active-business', p_plan: 'TOP', p_interval: 'annual' });
  client({ billing_quote: { data: null, error: { message: 'BILLING_RENEW_FIRST' } } });
  await expect(quoteAction('TOP', 'monthly')).resolves.toEqual({ success: false, error: 'This period ends within a day. Renew first, then change plan.' });
  client({ billing_quote: { data: null, error: { message: 'something internal' } } });
  await expect(quoteAction('TOP', 'monthly')).resolves.toEqual({ success: false, error: 'The price could not be worked out. Refresh and try again.' });
});

test('the app-wide banner reminds near the trial end, asks for payment in grace and explains read-only (SUB-09)', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const base = { subscribed: true as const, plan: 'GROW' as const, plan_name: 'Oga', billing_interval: 'monthly' as const,
    grace_ends_at: null, writes_allowed: true, entitlements: {} };
  expect(bannerFor({ ...base, status: 'trialing', current_period_end: '2026-11-20T10:00:00Z' }, now)).toBeNull();
  expect(bannerFor({ ...base, status: 'trialing', current_period_end: '2026-11-16T10:00:00Z' }, now))
    .toEqual({ tone: 'info', text: 'Your free Oga trial ends on 16 Nov 2026. Choose a plan to keep its features.', action: 'choose' });
  expect(bannerFor({ ...base, plan: 'BASE', plan_name: 'General', status: 'incomplete', current_period_end: '2026-11-16T10:00:00Z', grace_ends_at: '2026-11-23T10:00:00Z' }, now))
    .toEqual({ tone: 'warn', text: 'Payment due. Pay by 23 Nov 2026 to keep full access.', action: 'pay' });
  expect(bannerFor({ ...base, status: 'suspended', current_period_end: null, writes_allowed: false }, now)?.text).toBe('Your workspace is read-only until you pay. Nothing has been deleted.');
  expect(bannerFor({ ...base, status: 'active', current_period_end: '2026-12-02T10:00:00Z' }, now)).toBeNull();
  expect(bannerFor({ ...base, status: 'active', current_period_end: '2026-12-02T10:00:00Z',
    renewal: { invoice: 'CACU-INV-000009', plan: 'GROW', billing_interval: 'monthly', total_kobo: 645000, due_at: '2026-12-02T10:00:00Z', last_failure: 'Insufficient Funds' } }, now))
    .toMatchObject({ tone: 'warn', action: 'pay' });
  expect(bannerFor({ subscribed: false })).toBeNull();
});
