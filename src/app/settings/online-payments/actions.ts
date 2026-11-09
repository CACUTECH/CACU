'use server';
// Settings › Online payments (Doc 10 E23): connect the business's own Paystack account, see payments and payouts.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, paystackWebhookUrl, usesPythonAccounting } from '@/lib/accounting-client';
import type { CheckReport, OnlineOverview, PaystackSettings } from '@/lib/online-payments';

type Result<T> = { success: true; data: T } | { success: false; error: string };
type Raw = PaystackSettings & { webhook_token?: string };
const OFF = 'Turn on your books first. Online payments post straight into them.';
const failed = (error: unknown, fallback: string): { success: false; error: string } =>
  ({ success: false, error: error instanceof AccountingRequestError && error.status < 500 ? error.message : fallback });

// The webhook address is built here from the server's own API address.
function withWebhook(settings: Raw): PaystackSettings {
  const { webhook_token: token, ...rest } = settings;
  return { ...rest, webhook_url: token ? paystackWebhookUrl(token) : null };
}

export async function onlinePaymentsAction(): Promise<Result<OnlineOverview>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF };
    const data = await accountingRequest<OnlineOverview & { settings: Raw }>('online-payments');
    return { success: true, data: { ...data, settings: withWebhook(data.settings) } };
  } catch (error) { return failed(error, 'Online payments are unavailable. Try again.'); }
}

export async function connectPaystackAction(input: { request_key: string; secret_key: string; settlement_bank_account_id: string }): Promise<Result<PaystackSettings>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF };
    const data = await accountingRequest<Raw>('online-payments/paystack', { method: 'PUT', body: input });
    revalidatePath('/settings/online-payments');
    return { success: true, data: withWebhook(data) };
  } catch (error) { return failed(error, 'Paystack was not connected. Try again.'); }
}

export async function disconnectPaystackAction(): Promise<Result<PaystackSettings>> {
  try {
    const data = await accountingRequest<Raw>('online-payments/paystack', { method: 'DELETE' });
    revalidatePath('/settings/online-payments');
    return { success: true, data: withWebhook(data) };
  } catch (error) { return failed(error, 'Paystack was not disconnected. Try again.'); }
}

export async function checkPaystackAction(): Promise<Result<CheckReport>> {
  try {
    const data = await accountingRequest<CheckReport>('online-payments/check', { method: 'POST', body: {} });
    revalidatePath('/settings/online-payments');
    return { success: true, data };
  } catch (error) { return failed(error, 'Paystack could not be checked. Try again shortly.'); }
}
