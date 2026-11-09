'use server';
// The public pay page (Doc 10 E23). No CACU account: the link token names one invoice, and the accounting API checks it.
import { AccountingRequestError, publicPayRequest } from '@/lib/accounting-client';
import type { PayStatus, PaySummary } from '@/lib/online-payments';

type Result<T> = { success: true; data: T } | { success: false; error: string; gone?: boolean };
function failed(error: unknown, fallback: string): { success: false; error: string; gone?: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, gone: error instanceof AccountingRequestError && error.status === 404 };
}

export async function paySummaryAction(token: string): Promise<Result<PaySummary>> {
  try { return { success: true, data: await publicPayRequest<PaySummary>(token, '') }; }
  catch (error) { return failed(error, 'This invoice cannot be shown right now. Try again shortly.'); }
}

export async function startPayAction(token: string, amount: string, email: string | null): Promise<Result<{ authorization_url: string; reference: string }>> {
  try {
    const data = await publicPayRequest<{ authorization_url: string; reference: string }>(token, '', { amount, email: email || null });
    // Only Paystack's own checkout page, never any other address.
    if (!/^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//.test(data.authorization_url)) return { success: false, error: 'Paystack could not start the payment. Try again.' };
    return { success: true, data };
  } catch (error) { return failed(error, 'Paystack could not start the payment. Try again shortly.'); }
}

export async function verifyPayAction(token: string, reference: string): Promise<Result<PayStatus>> {
  try {
    if (!/^CACU-PAY-[0-9a-f]{32}$/.test(reference)) return { success: false, error: 'This payment reference is not one of ours.' };
    return { success: true, data: await publicPayRequest<PayStatus>(token, 'verify', { reference }) };
  } catch (error) { return failed(error, 'We could not check the payment yet. Refresh in a minute.'); }
}
