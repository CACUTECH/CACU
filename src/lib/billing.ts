// CACU subscription plans as the database returns them (public.billing_plans, public.business_plan). Prices exclude
// VAT; the server adds it on the invoice, so the screen shows both and never computes what is charged.
export type PlanCode = 'BASE' | 'GROW' | 'TOP';
export type BillingInterval = 'monthly' | 'annual';
export type Entitlements = Record<string, unknown>;
export type Plan = { code: PlanCode; name: string; monthly_price_kobo: number; annual_price_kobo: number | null; currency: 'NGN'; entitlements: Entitlements };
export type SubscriptionStatus = 'trialing' | 'incomplete' | 'active' | 'past_due' | 'grace' | 'suspended' | 'cancelled' | 'closed';
export type CurrentPlan = { subscribed: false } | {
  subscribed: true; plan: PlanCode; plan_name: string; status: SubscriptionStatus; billing_interval: BillingInterval;
  current_period_end: string | null; grace_ends_at: string | null; writes_allowed: boolean; entitlements: Entitlements;
};
export type BillingInvoice = { invoice: string; plan: PlanCode; billing_interval: BillingInterval; subtotal_kobo: number; vat_kobo: number;
  total_kobo: number; status: 'open' | 'paid' | 'review' | 'void'; created_at: string; paid_at: string | null; receipt: string | null };
export type CheckoutResult = { invoice: string; reference: string; total_kobo: number; vat_kobo: number; subtotal_kobo: number; authorization_url: string };
export type VerifyOutcome = { outcome: string };

export const VAT_NOTE = 'Prices exclude 7.5% VAT, added at checkout.';
const PLAN_LINE: Record<PlanCode, string> = {
  BASE: 'For a one-person shop getting its books in order.',
  GROW: 'For a growing shop with staff, suppliers and stock to manage.',
  TOP: 'For bigger or mixed businesses that sell goods and services together.',
};
export const planLine = (code: PlanCode) => PLAN_LINE[code];

export function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: kobo % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function price(plan: Plan, interval: BillingInterval) {
  return interval === 'annual' ? plan.annual_price_kobo : plan.monthly_price_kobo;
}

const STATUS: Record<SubscriptionStatus, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  trialing: { label: 'Free trial', tone: 'good' },
  incomplete: { label: 'Payment due', tone: 'warn' },
  active: { label: 'Active', tone: 'good' },
  past_due: { label: 'Payment overdue', tone: 'warn' },
  grace: { label: 'Payment overdue', tone: 'warn' },
  suspended: { label: 'Read-only until paid', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  closed: { label: 'Closed', tone: 'bad' },
};
export const statusOf = (status: SubscriptionStatus) => STATUS[status];

const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** One plain sentence on what happens next for this subscription. */
export function nextStep(current: Extract<CurrentPlan, { subscribed: true }>) {
  const end = current.current_period_end && day(current.current_period_end);
  const grace = current.grace_ends_at && day(current.grace_ends_at);
  switch (current.status) {
    case 'trialing': return `Your free trial of the ${current.plan_name} Plan ends on ${end}. Choose a plan to keep going; otherwise you move to the General Plan.`;
    case 'active': return `Paid until ${end}.`;
    case 'incomplete': case 'past_due': case 'grace':
      return `Pay by ${grace ?? end} to keep full access. Nothing is deleted if you pay late.`;
    case 'suspended': return 'Your workspace is read-only until you pay. You can still view and export everything.';
    default: return 'Choose a plan to reopen your workspace with all your data.';
  }
}

/** The handful of limits an owner compares, in their words. */
export function highlights(entitlements: Entitlements): string[] {
  const n = (key: string) => entitlements[key];
  const count = (key: string, one: string, many: string) => {
    const value = n(key);
    return value === null ? `Unlimited ${many}` : `${Number(value).toLocaleString('en-NG')} ${value === 1 ? one : many}`;
  };
  const lines = [count('users.max', 'user', 'users'), count('outlets.max', 'outlet', 'outlets'), count('catalog.max_items', 'catalogue item', 'catalogue items')];
  const modes = n('module.modes');
  lines.push(Array.isArray(modes) && modes.includes('HYBRID') ? 'Products, services or Hybrid' : 'Products or services');
  if (n('module.purchasing') === true) lines.push('Purchasing and supplier bills');
  if (n('reports.advanced') === true) lines.push('Cash flow and ageing reports');
  const ai = n('ai.queries_per_month');
  if (typeof ai === 'number' && ai > 0) lines.push(`${ai} AI questions a month`);
  return lines;
}

/** Paystack sends the owner back with ?reference= (and ?trxref=). Only CACU subscription references are accepted. */
export function returnedReference(search: URLSearchParams) {
  const reference = search.get('reference') ?? search.get('trxref');
  return reference && /^CACU-SUB-[0-9a-f]{32}$/.test(reference) ? reference : null;
}

export function isCheckoutUrl(url: unknown): url is string {
  try { return typeof url === 'string' && new URL(url).protocol === 'https:' && new URL(url).hostname === 'checkout.paystack.com'; }
  catch { return false; }
}
