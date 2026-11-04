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
  usage?: Partial<Record<LimitKey, number>>; scheduled_plan?: PlanCode | null; scheduled_interval?: BillingInterval | null;
  card?: SavedCard | null; renewal?: Renewal | null;
};
export type SavedCard = { card_type: string | null; bank: string | null; last4: string | null; exp_month: string | null; exp_year: string | null };
export type Renewal = { invoice: string; plan: PlanCode; billing_interval: BillingInterval; total_kobo: number; due_at: string; last_failure: string | null };
export type LimitKey = 'users.max' | 'outlets.max' | 'catalog.max_items' | 'ai.queries_per_month';
export type BillingInvoice = { invoice: string; plan: PlanCode; billing_interval: BillingInterval; subtotal_kobo: number; vat_kobo: number;
  total_kobo: number; status: 'open' | 'paid' | 'review' | 'void'; created_at: string; paid_at: string | null; receipt: string | null; kind?: 'subscription' | 'upgrade' | 'renewal' };
export type CheckoutResult = { invoice: string; reference: string; total_kobo: number; vat_kobo: number; subtotal_kobo: number; authorization_url: string };
export type Quote = { kind: 'subscription' | 'upgrade'; subtotal_kobo: number; vat_kobo: number; total_kobo: number; credit_kobo: number | null; period_end: string | null };
export type ScheduleResult = { scheduled_plan: PlanCode | null; scheduled_interval?: BillingInterval | null; effective_at: string | null; over_limits: Partial<Record<LimitKey, { used: number; limit: number }>> };
export type VerifyOutcome = { outcome: string };

export const VAT_NOTE = 'Prices exclude 7.5% VAT, added at checkout.';
const PLAN_LINE: Record<PlanCode, string> = {
  BASE: 'For a one-person shop getting its books in order.',
  GROW: 'For a growing shop with staff, suppliers and stock to manage.',
  TOP: 'For bigger or mixed businesses that sell goods and services together.',
};
export const planLine = (code: PlanCode) => PLAN_LINE[code];
const PLAN_NAME: Record<PlanCode, string> = { BASE: 'General', GROW: 'Oga', TOP: 'Chairman' };
const RANK: Record<PlanCode, number> = { BASE: 1, GROW: 2, TOP: 3 };

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
    case 'active': {
      const moves = [current.scheduled_plan && `move to the ${PLAN_NAME[current.scheduled_plan]} Plan`,
        current.scheduled_interval && `switch to ${current.scheduled_interval === 'annual' ? 'yearly' : 'monthly'} billing`].filter(Boolean);
      return moves.length ? `Paid until ${end}. You ${moves.join(' and ')} then.` : `Paid until ${end}.`;
    }
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

const LIMITS: [LimitKey, string][] = [['users.max', 'Users'], ['outlets.max', 'Outlets'], ['catalog.max_items', 'Catalogue items'], ['ai.queries_per_month', 'AI questions this month']];

/** What the business uses against each counted limit. A full limit is flagged so the owner knows why adding fails. */
export function usageLines(current: Extract<CurrentPlan, { subscribed: true }>) {
  return LIMITS.flatMap(([key, label]) => {
    const used = current.usage?.[key];
    if (typeof used !== 'number') return [];
    const limit = current.entitlements[key];
    const capped = typeof limit === 'number';
    if (limit === 0) return [{ key, label, text: 'Not on this plan', full: false }];
    const n = (value: number) => value.toLocaleString('en-NG');
    return [{ key, label, text: capped ? `${n(used)} of ${n(limit)}` : `${n(used)} (unlimited)`, full: capped && used >= limit }];
  });
}

export type PlanAction = { kind: 'checkout' | 'upgrade' | 'schedule' | 'cancel' | 'current' | 'none'; label: string; note?: string };

/** What choosing a plan and interval does (Doc 14 SUB-05 to SUB-07). Without a paid period, any plan is bought outright.
 * During one: a bigger plan on the same interval, or monthly to yearly, is paid now; a smaller plan or yearly to
 * monthly waits for the period to end. */
export function planAction(current: CurrentPlan, plan: Plan, period: BillingInterval): PlanAction {
  const name = PLAN_NAME[plan.code];
  if (!current.subscribed || current.status !== 'active') {
    return { kind: price(plan, period) === null ? 'none' : 'checkout', label: `Choose ${name}` };
  }
  if (price(plan, period) === null) return { kind: 'none', label: `Choose ${name}` };
  const rank = RANK[plan.code] - RANK[current.plan], from = current.billing_interval;
  if (rank === 0 && period === from) return { kind: 'current', label: 'Current plan' };
  if (period === 'annual' && from === 'monthly' && rank >= 0) {
    return { kind: 'upgrade', label: rank === 0 ? 'Switch to yearly' : `Upgrade to ${name} yearly`,
      note: 'Your unused days this month count toward the year. You see the exact amount before paying.' };
  }
  if (rank > 0) {
    if (period !== from) return { kind: 'none', label: 'Available when your year ends' };
    return { kind: 'upgrade', label: `Upgrade to ${name}`, note: 'You pay the difference for the days left in this period, plus VAT.' };
  }
  const end = current.current_period_end ? day(current.current_period_end) : 'the end of this period';
  const scheduledPlan = current.scheduled_plan ?? current.plan, scheduledInterval = current.scheduled_interval ?? from;
  const pending = Boolean(current.scheduled_plan || current.scheduled_interval);
  const change = rank === 0 ? `Switch to ${period === 'annual' ? 'yearly' : 'monthly'}` : `Move to ${name}${period !== from ? ` ${period === 'annual' ? 'yearly' : 'monthly'}` : ''}`;
  if (pending && scheduledPlan === plan.code && scheduledInterval === period) return { kind: 'cancel', label: 'Keep my current plan', note: `${change} on ${end} is scheduled.` };
  return { kind: 'schedule', label: `${change} on ${end}`, note: 'No charge now. Your current plan runs until then.' };
}

/** The confirmation before paying mid-period (SUB-R05): the exact amount, VAT and any credit for unused days. */
export function quoteLine(quote: Quote) {
  const credit = quote.credit_kobo ? `, after ${naira(quote.credit_kobo)} for your unused days` : '';
  return `Pay ${naira(quote.total_kobo)} now: ${naira(quote.subtotal_kobo)} + ${naira(quote.vat_kobo)} VAT${credit}.`;
}

const LIMIT_NOUN: Record<LimitKey, string> = { 'users.max': 'users', 'outlets.max': 'outlets', 'catalog.max_items': 'catalogue items', 'ai.queries_per_month': 'AI questions a month' };

/** The saved card in an owner's words, e.g. "Visa ending 4081, expires 12/2030". */
export function cardLine(card: SavedCard) {
  const brand = card.card_type ? card.card_type.charAt(0).toUpperCase() + card.card_type.slice(1).trim() : 'Card';
  const expiry = card.exp_month && card.exp_year ? `, expires ${card.exp_month}/${card.exp_year}` : '';
  return `${brand} ending ${card.last4 ?? '••••'}${expiry}`;
}

/** SUB-04, SUB-08: the renewal that is due, and how it will be paid. */
export function renewalLine(renewal: Renewal, card: SavedCard | null | undefined) {
  const amount = `${naira(renewal.total_kobo)} (${PLAN_NAME[renewal.plan]} Plan, VAT included)`;
  if (renewal.last_failure) return `Your card payment of ${amount} did not go through: ${renewal.last_failure}. Pay now to keep full access.`;
  return card ? `Renewal of ${amount} is due on ${day(renewal.due_at)}. We'll charge your ${cardLine(card)}.`
    : `Renewal of ${amount} is due on ${day(renewal.due_at)}. Pay now, or your plan stops when the period ends.`;
}

/** After scheduling a smaller plan: where the business is over its limits. Nothing is removed. */
export function overLimitNotes(result: ScheduleResult) {
  if (!result.scheduled_plan) return [];
  const name = PLAN_NAME[result.scheduled_plan];
  return (Object.entries(result.over_limits) as [LimitKey, { used: number; limit: number }][]).map(([key, { used, limit }]) =>
    `You have ${used.toLocaleString('en-NG')} ${LIMIT_NOUN[key]}; the ${name} Plan allows ${limit.toLocaleString('en-NG')}. Nothing is removed, but you can't add more until you're under the limit.`);
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
