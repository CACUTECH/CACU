
import { accountingRequest, decimalInput, usesPythonAccounting } from '@/lib/accounting-client';
import { randomUUID } from 'node:crypto';
import { BaseService } from './base-service';
import { NotificationService } from './notification-service';

/**
 * @fileOverview PaymentService handles collection and ledger synchronization.
 */
export class PaymentService extends BaseService {
  async recordPayment(paymentData: {
    invoiceId: string;
    customerId?: string;
    amount: number | string;
    method: string;
    reference?: string;
    requestKey?: string;
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    if (await usesPythonAccounting()) {
      const result = await accountingRequest<{ source_id: string; outstanding: string }>('receipts', { method: 'POST', body: {
        request_key: paymentData.requestKey || randomUUID(), invoice_id: paymentData.invoiceId,
        amount: decimalInput(paymentData.amount), method: paymentData.method,
        entry_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()),
      } });
      return { paymentId: result.source_id, outstanding: result.outstanding };
    }
    const { data: paymentId, error } = await supabase.rpc('record_payment_atomic', {
      p_business_id: businessId,
      p_invoice_id: paymentData.invoiceId,
      p_customer_id: paymentData.customerId || null,
      p_amount: paymentData.amount,
      p_payment_method: paymentData.method,
      p_reference: paymentData.reference || null
    });

    if (error) {
      throw new Error(`Payment Integrity Error: ${error.message || 'Transaction rolled back'}`);
    }

    // Trigger Notification
    const notificationService = new NotificationService();
    await notificationService.trigger({
      title: 'Payment Received',
      message: `₦${paymentData.amount.toLocaleString()} received via ${paymentData.method}.`,
      type: 'PAYMENT_RECEIVED',
      metadata: { paymentId, invoiceId: paymentData.invoiceId }
    });

    return { paymentId };
  }
}
