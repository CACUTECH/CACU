'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import type { CollectionAccount } from '@/lib/collection-accounts';
import type { ActionResult, BillInput, ExpenseAccount, SupplierBill, SupplierPaymentInput } from '@/lib/corrections';

function failed(error: unknown) {
  // A 4xx answer means nothing was recorded; anything else may have been, so the same request key is retried.
  return { success: false as const, error: error instanceof Error ? error.message : 'Not confirmed.',
    uncertain: !(error instanceof AccountingRequestError && error.status < 500) };
}

export async function getBillsAction(): Promise<ActionResult<{ native: boolean; bills: SupplierBill[]; accounts: ExpenseAccount[]; banks: CollectionAccount[]; suppliers: { id: string; name: string }[] }>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: { native: false, bills: [], accounts: [], banks: [], suppliers: [] } };
    const supabase = await createClient(); const businessId = await getActiveBusinessIdAction();
    const [bills, accounts, banks, suppliers] = await Promise.all([
      accountingRequest<SupplierBill[]>('supplier-bills'), accountingRequest<ExpenseAccount[]>('expense-accounts'), accountingRequest<CollectionAccount[]>('collection-accounts'),
      supabase.from('suppliers').select('id,name').eq('business_id', businessId).order('name')]);
    if (suppliers.error) throw new Error('Suppliers unavailable');
    return { success: true, data: { native: true, bills, accounts, banks, suppliers: suppliers.data || [] } };
  } catch (error) { return failed(error); }
}

export async function recordBillAction(input: BillInput) {
  try {
    const data = await accountingRequest<{ id: string }>('supplier-bills', { method: 'POST', body: input });
    revalidatePath('/accounting/bills');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}

export async function paySupplierBillAction(billId: string, input: SupplierPaymentInput) {
  try {
    const data = await accountingRequest<{ id: string }>(`supplier-bills/${encodeURIComponent(billId)}/payments`, { method: 'POST', body: input });
    revalidatePath('/accounting/bills');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}
