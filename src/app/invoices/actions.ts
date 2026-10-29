
'use server';

import { InvoiceService, type InvoiceInput, type InvoiceLineInput } from '@/services/invoice-service';
import { PaymentService } from '@/services/payment-service';
import { AccountingRequestError } from '@/lib/accounting-client';
import { revalidatePath } from 'next/cache';

export async function createInvoiceAction(invoiceData: InvoiceInput, items: InvoiceLineInput[]) {
  try {
    const service = new InvoiceService();
    await service.createInvoice(invoiceData, items);
    revalidatePath('/invoices');
    revalidatePath('/transactions');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invoice update failed' };
  }
}

export async function markAsPaidAction(paymentData: Parameters<PaymentService['recordPayment']>[0]) {
  try {
    const service = new PaymentService();
    await service.recordPayment(paymentData);
    revalidatePath('/invoices');
    revalidatePath('/transactions');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Payment failed', retryable: !(error instanceof AccountingRequestError && error.status >= 400 && error.status < 500) };
  }
}

export async function updateInvoiceStatusAction(id: string, status: string) {
  try {
    const service = new InvoiceService();
    await service.updateInvoiceStatus(id, status);
    revalidatePath('/invoices');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invoice update failed' };
  }
}

export async function getInvoiceBalancesAction() {
  const { accountingRequest, usesPythonAccounting } = await import('@/lib/accounting-client');
  if (!(await usesPythonAccounting())) return new InvoiceService().listBalances();
  return accountingRequest<{ id: string; total: string; outstanding: string }[]>('invoices/balances');
}
