
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
import type { CheckoutOptions, SaleReceipt } from '@/lib/checkout';

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
