'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { DailyReconciliation } from '@/lib/transfers';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : 'The change was not confirmed. Refresh before trying again.', uncertain: !known };
}

export async function getDailyReconciliationAction(day: string): Promise<Result<DailyReconciliation | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<DailyReconciliation>(`reconciliation/daily?day=${encodeURIComponent(day)}`) };
  } catch (error) { return failed(error); }
}

export async function confirmTransferAction(id: string, requestKey: string, bankAccountId: string): Promise<Result<unknown>> {
  try {
    const data = await accountingRequest(`transfers/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { request_key: requestKey, bank_account_id: bankAccountId } });
    revalidatePath('/reconciliation/daily'); revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function transferNotReceivedAction(id: string, requestKey: string, note: string): Promise<Result<unknown>> {
  try {
    const data = await accountingRequest(`transfers/${encodeURIComponent(id)}/not-received`, { method: 'POST', body: { request_key: requestKey, note } });
    revalidatePath('/reconciliation/daily'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export type Shortfall = { sale_id: string; item_id: string; item: string; quantity: number; created_at: string; reviewed: boolean };

/** Overselling setting and the stock sold beyond records, for the owner's review (BR-022, RSK-027). */
export async function getStockControlAction(): Promise<Result<{ allow_oversell: boolean; shortfalls: Shortfall[] } | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    const [options, shortfalls] = await Promise.all([accountingRequest<{ allow_oversell: boolean }>('sales/options'),
      accountingRequest<Shortfall[]>('stock/shortfalls').catch(() => [] as Shortfall[])]);
    return { success: true, data: { allow_oversell: options.allow_oversell, shortfalls } };
  } catch (error) { return failed(error); }
}

export async function saveOversellAction(allow: boolean): Promise<Result<{ allow_oversell: boolean }>> {
  try {
    const data = await accountingRequest<{ allow_oversell: boolean }>('sales/policy', { method: 'POST', body: { allow_oversell: allow } });
    revalidatePath('/pos');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function reviewShortfallAction(saleId: string, itemId: string): Promise<Result<unknown>> {
  try {
    return { success: true, data: await accountingRequest(`stock/shortfalls/${encodeURIComponent(saleId)}/${encodeURIComponent(itemId)}/review`, { method: 'POST', body: {} }) };
  } catch (error) { return failed(error); }
}
