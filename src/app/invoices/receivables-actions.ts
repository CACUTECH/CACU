'use server';
// Receivables (Doc 10 E11): a payment for several invoices, customer advances, ageing and statements. These post to the
// books, so they need the accounting API (the books turned on).
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { Ageing, OpenItems, PaymentResult, Statement } from '@/lib/receivables';

type Result<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
const OFF = 'Turn on your books to use this. It works once CACU keeps your accounts.';
function failed(error: unknown, fallback = 'The change was not confirmed. Retry with the same details to check whether it was recorded.'): { success: false; error: string; uncertain: boolean } {
  const known = error instanceof AccountingRequestError && error.status < 500;
  return { success: false, error: known ? error.message : fallback, uncertain: !known };
}
const id = (value: string) => encodeURIComponent(value);

export async function customerOpenItemsAction(customerId: string): Promise<Result<OpenItems>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    return { success: true, data: await accountingRequest<OpenItems>(`customers/${id(customerId)}/open-items`) };
  } catch (error) { return failed(error, 'Open invoices are unavailable. Try again.'); }
}

export async function recordCustomerPaymentAction(payment: { request_key: string; customer_id: string; amount: string; entry_date: string;
  method: 'Cash' | 'Transfer'; bank_account_id: string | null; allocations: { invoice_id: string; amount: string }[] }): Promise<Result<PaymentResult>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    const data = await accountingRequest<PaymentResult>('customer-receipts', { method: 'POST', body: payment });
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function applyAdvanceAction(invoiceId: string, requestKey: string, amount: string): Promise<Result<{ outstanding: string; advance: string }>> {
  try {
    const data = await accountingRequest<{ outstanding: string; advance: string }>(`invoices/${id(invoiceId)}/apply-advance`,
      { method: 'POST', body: { request_key: requestKey, amount } });
    revalidatePath('/invoices');
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function refundAdvanceAction(customerId: string, refund: { request_key: string; amount: string; method: 'Cash' | 'Transfer';
  bank_account_id: string | null; note: string }): Promise<Result<{ advance: string }>> {
  try {
    const data = await accountingRequest<{ advance: string }>(`customers/${id(customerId)}/advance-refund`, { method: 'POST', body: refund });
    return { success: true, data };
  } catch (error) { return failed(error); }
}

export async function customerStatementAction(customerId: string, start: string, end: string): Promise<Result<Statement>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF, uncertain: false };
    return { success: true, data: await accountingRequest<Statement>(`customers/${id(customerId)}/statement?start_date=${id(start)}&end_date=${id(end)}`) };
  } catch (error) { return failed(error, 'The statement is unavailable. Try again.'); }
}

export async function ageingAction(type: 'receivables' | 'payables', asOf: string): Promise<Result<Ageing | null>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: null };
    return { success: true, data: await accountingRequest<Ageing>(`reports/ageing?type=${type}&as_of=${id(asOf)}`) };
  } catch (error) { return failed(error, 'Ageing is unavailable. Try again.'); }
}
