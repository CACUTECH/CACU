
'use server';

import { InvoiceService } from '@/services/invoice-service';
import { PaymentService } from '@/services/payment-service';
import { revalidatePath } from 'next/cache';

export async function createInvoiceAction(invoiceData: any, items: any[]) {
  try {
    const service = new InvoiceService();
    await service.createInvoice(invoiceData, items);
    revalidatePath('/invoices');
    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function markAsPaidAction(paymentData: any) {
  try {
    const service = new PaymentService();
    await service.recordPayment(paymentData);
    revalidatePath('/invoices');
    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateInvoiceStatusAction(id: string, status: string) {
  try {
    const service = new InvoiceService();
    await service.updateInvoiceStatus(id, status);
    revalidatePath('/invoices');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
