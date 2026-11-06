
'use server';

import { SalesService } from '@/services/sales-service';
import { revalidatePath } from 'next/cache';

export async function processCheckoutAction(data: Parameters<SalesService['processCheckout']>[0]) {
  try {
    const service = new SalesService();
    const result = await service.processCheckout(data);
    
    // Invalidate caches to refresh stock and transaction lists
    revalidatePath('/pos');
    revalidatePath('/inventory');
    revalidatePath('/transactions');
    revalidatePath('/');
    
    return { success: true as const, saleId: result.saleId, status: result.status ?? 'completed', change: result.change ?? null,
      invoiceNumber: result.invoice_number ?? null, shortfalls: result.shortfalls ?? [] };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Checkout failed' };
  }
}

import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { CheckoutOptions, Refund, Refundable, SaleReceipt, TillSale } from '@/lib/checkout';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
function failed(error: unknown, fallback: string): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}

/** The day's till sales, newest first; null before the books are turned on. */
export async function getTillSalesAction(day: string): Promise<Result<TillSale[] | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<TillSale[]>(`sales?day=${encodeURIComponent(day)}`) };
  } catch (error) { return failed(error, 'Sales are unavailable. Refresh to try again.'); }
}

export async function getRefundableAction(saleId: string): Promise<Result<Refundable>> {
  try { return { success: true, data: await accountingRequest<Refundable>(`sales/${encodeURIComponent(saleId)}/refundable`) }; }
  catch (error) { return failed(error, 'Refund details are unavailable. Refresh to try again.'); }
}

export type RefundInput = {
  requestKey: string; method: 'Cash' | 'Transfer'; bankAccountId?: string; reason: string;
  lines: { lineId: string; quantity: number; restock: boolean }[];
};

/** Doc 10 / PR-16: refunds within the person's approval limit are paid at once; others wait for approval (FR-044). */
export async function requestRefundAction(saleId: string, input: RefundInput): Promise<Result<Refund>> {
  try {
    const data = await accountingRequest<Refund>(`sales/${encodeURIComponent(saleId)}/refunds`, { method: 'POST', body: {
      request_key: input.requestKey, method: input.method, bank_account_id: input.bankAccountId || null, reason: input.reason,
      lines: input.lines.map(l => ({ line_id: l.lineId, quantity: l.quantity, restock: l.restock })) } });
    revalidatePath('/pos/sales'); revalidatePath('/reconciliation/daily'); revalidatePath('/catalog');
    return { success: true, data };
  } catch (error) { return failed(error, 'The refund was not confirmed. Refresh before trying again.'); }
}

/** The member's discount limit and whether overselling is on; null before the books are turned on. */
export async function getCheckoutOptionsAction(): Promise<CheckoutOptions | null> {
  if (!(await usesPythonAccounting())) return null;
  try { return await accountingRequest<CheckoutOptions>('sales/options'); }
  catch { return { discount_cap: '0', allow_oversell: false }; }
}

export async function getReceiptAction(id: string): Promise<{ success: true; data: SaleReceipt } | { success: false; error: string }> {
  try { return { success: true, data: await accountingRequest<SaleReceipt>(`sales/${encodeURIComponent(id)}/receipt`) }; }
  catch (error) { return { success: false, error: error instanceof AccountingRequestError && error.status < 500 ? error.message : 'The receipt is unavailable. Refresh to try again.' }; }
}
