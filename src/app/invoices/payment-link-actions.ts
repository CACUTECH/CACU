'use server';
// Pay links for invoices (Doc 10 E23): the customer pays on Paystack, into the business's own account.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { PayLink } from '@/lib/online-payments';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown, fallback: string): { success: false; error: string } =>
  ({ success: false, error: error instanceof AccountingRequestError && error.status < 500 ? error.message : fallback });
const appUrl = () => (process.env.CACU_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');

export async function sharePaymentLinkAction(invoiceId: string, requestKey: string): Promise<Result<PayLink & { url: string }>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: 'Turn on your books first. Online payments post straight into them.' };
    const data = await accountingRequest<PayLink>(`invoices/${encodeURIComponent(invoiceId)}/payment-link`, { method: 'POST', body: { request_key: requestKey } });
    return { success: true, data: { ...data, url: `${appUrl()}/pay/${data.token}` } };
  } catch (error) { return failed(error, 'The pay link was not made. Try again.'); }
}

export async function revokePaymentLinkAction(invoiceId: string): Promise<Result<{ revoked: boolean }>> {
  try {
    const data = await accountingRequest<{ revoked: boolean }>(`invoices/${encodeURIComponent(invoiceId)}/payment-link/revoke`, { method: 'POST', body: {} });
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error, 'The pay link was not withdrawn. Try again.'); }
}
