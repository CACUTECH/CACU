import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import type { CashFlowReport } from '@/lib/cash-flow';
import { routeParts, serviceUrl } from '@/lib/service-url';

export class AccountingRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'AccountingRequestError'; }
}

export async function accountingRequest<T>(path: string, options?: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }): Promise<T> {
  const base = process.env.CACU_ACCOUNTING_API_URL;
  if (!base) throw new Error('Accounting API is not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Accounting API requires HTTPS');
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Authentication required');
  const businessId = await getActiveBusinessIdAction();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw new Error('Valid session required');
  // The host is the configured API; the business id and route are checked segment by segment (no "..", "/" or URLs).
  const { segments, query } = routeParts(path);
  const target = serviceUrl(url, ['api', 'v1', 'businesses', businessId, ...segments], query);
  const response = await fetch(target, {
    method: options?.method || 'GET', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      const failure: { detail?: unknown } = await response.json().catch(() => ({}));
      if (typeof failure.detail === 'string' && failure.detail.length <= 500) throw new AccountingRequestError(failure.detail, response.status);
    }
    throw new AccountingRequestError(`Accounting request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}
// A file from the accounting API (the full data export, E22): the raw response for a route handler to pass on.
export async function accountingDownload(path: string): Promise<Response> {
  const base = process.env.CACU_ACCOUNTING_API_URL;
  if (!base) throw new Error('Accounting API is not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Accounting API requires HTTPS');
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AccountingRequestError('Sign in to download', 401);
  const businessId = await getActiveBusinessIdAction();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new AccountingRequestError('Sign in to download', 401);
  const { segments, query } = routeParts(path);
  const response = await fetch(serviceUrl(url, ['api', 'v1', 'businesses', businessId, ...segments], query), {
    headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const failure: { detail?: unknown } = await response.json().catch(() => ({}));
    throw new AccountingRequestError(typeof failure.detail === 'string' && failure.detail.length <= 500 && response.status < 500 ? failure.detail : 'The file is unavailable. Try again.', response.status);
  }
  return response;
}
// A customer paying from a pay link (Doc 10 E23): no CACU account and no user token. The link token alone names the
// invoice; the API checks it, and answers only for that one invoice.
export async function publicPayRequest<T>(token: string, action: '' | 'verify', body?: unknown): Promise<T> {
  const base = process.env.CACU_ACCOUNTING_API_URL;
  if (!base) throw new Error('Accounting API is not configured');
  if (!/^[0-9a-f]{64}$/.test(token)) throw new AccountingRequestError('This pay link does not work.', 404);
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Accounting API requires HTTPS');
  const target = serviceUrl(url, ['api', 'v1', 'pay', token, ...(action ? [action] : [])]);
  const response = await fetch(target, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const failure: { detail?: unknown } = await response.json().catch(() => ({}));
    if (response.status < 500 && typeof failure.detail === 'string' && failure.detail.length <= 500) throw new AccountingRequestError(failure.detail, response.status);
    throw new AccountingRequestError(`Payment request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

// The address Paystack sends the business's events to: the accounting API's own host, never a browser-supplied one.
export function paystackWebhookUrl(webhookToken: string): string | null {
  const base = process.env.CACU_ACCOUNTING_API_URL;
  if (!base || !/^[0-9a-f]{64}$/.test(webhookToken)) return null;
  return serviceUrl(new URL(base), ['api', 'v1', 'webhooks', 'paystack', webhookToken]).toString();
}

export function getCashFlow(start: string, end: string) {
  return accountingRequest<CashFlowReport>(`reports/cash-flow?${new URLSearchParams({ start_date: start, end_date: end })}`);
}

export async function usesPythonAccounting(): Promise<boolean> {
  const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
  const { data, error } = await supabase.rpc('accounting_mode', { p_business_id: businessId });
  // Only the known absent-function error means the additive migration is uninstalled.
  if (error?.code === 'PGRST202' || error?.code === '42883') return false;
  if (error) throw new Error('Accounting cutover status unavailable');
  if (data !== 'python' && data !== 'legacy') throw new Error('Invalid accounting cutover status');
  return data === 'python';
}
export function decimalInput(value: number | string): string {
  if (typeof value === 'string' && /^\d{1,13}(\.\d{1,2})?$/.test(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100))) return value.toFixed(2);
  throw new Error('Invalid amount');
}

export type AccountingSummary = {
  income: string; expenses: string; net_profit: string; cash: string; inventory: string; receivables: string;
  assets: { cash: string; inventory: string; receivables: string; total: string };
  liabilities: { total: string }; equity: { capital: string; retainedEarnings: string; total: string };
  balance_sheet_difference: string; trial_balance_difference: string; transaction_count: number;
  trial_balance: { account_id: string; name: string; type: string; debit: string; credit: string }[];
  revenue_trend: { period: string; income: string }[];
};
export function getAccountingSummary(start: string, end: string) {
  return accountingRequest<AccountingSummary>(`reports/summary?${new URLSearchParams({ start_date: start.slice(0, 10), end_date: end.slice(0, 10) })}`);
}
