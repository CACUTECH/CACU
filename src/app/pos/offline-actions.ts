'use server';
// Offline selling (Doc 10 E17): sales kept on a device are sent here when it is back online. The server checks each one;
// it posts as sold or waits for review. Never final on the device.
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest } from '@/lib/accounting-client';
import type { OfflineExpensePayload, OfflinePayload } from '@/lib/offline-outbox';

export type SyncResult = { status: 'posted' | 'review' | 'discarded'; sale_id: string; reason?: string | null; detail?: string | null; shortfalls?: { item_id: string; quantity: number }[] };
export type ReviewSale = {
  id: string; kind: 'sale' | 'expense'; seller: string; sold_at: string; method: string; total: string; reason: string; reason_text: string; detail: string | null;
  can_decide: boolean; items: { name: string; quantity: number; unit_price: string; discount_percent: string }[];
  description?: string; account?: string; entry_date?: string;
};
type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback: string): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

export async function syncOfflineSaleAction(payload: OfflinePayload): Promise<Result<SyncResult>> {
  try {
    const data = await accountingRequest<SyncResult>('sales/offline', { method: 'POST', body: payload });
    if (data.status === 'posted') { revalidatePath('/pos'); revalidatePath('/pos/sales'); }
    return { success: true, data };
  } catch (error) { return failed(error, 'Not sent yet. It will be tried again.'); }
}

export async function syncOfflineExpenseAction(payload: OfflineExpensePayload): Promise<Result<SyncResult>> {
  try {
    const data = await accountingRequest<SyncResult>('expenses/offline', { method: 'POST', body: payload });
    if (data.status === 'posted') revalidatePath('/accounting/expenses');
    return { success: true, data };
  } catch (error) { return failed(error, 'Not sent yet. It will be tried again.'); }
}

export async function offlineReviewAction(): Promise<Result<{ can_decide: boolean; sales: ReviewSale[] }>> {
  try { return { success: true, data: await accountingRequest<{ can_decide: boolean; sales: ReviewSale[] }>('offline-review') }; }
  catch (error) { return failed(error, 'Offline sales for review are unavailable. Refresh to try again.'); }
}

export async function decideOfflineSaleAction(id: string, decision: 'post' | 'discard', note: string): Promise<Result<SyncResult>> {
  try {
    const data = await accountingRequest<SyncResult>(`offline-review/${encodeURIComponent(id)}`, { method: 'POST', body: { decision, note } });
    revalidatePath('/pos/sales'); revalidatePath('/accounting/expenses');
    return { success: true, data };
  } catch (error) { return failed(error, 'The decision was not confirmed. Refresh before trying again.'); }
}
