
import { AccountingRequestError, accountingRequest, decimalInput, usesPythonAccounting } from '@/lib/accounting-client';
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
    bankAccountId?: string;
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    if (await usesPythonAccounting()) {
      const result = await accountingRequest<{ source_id: string; outstanding: string }>('receipts', { method: 'POST', body: {
        request_key: paymentData.requestKey || randomUUID(), invoice_id: paymentData.invoiceId,
        amount: decimalInput(paymentData.amount), method: paymentData.method,
        bank_account_id: paymentData.bankAccountId || null,
        entry_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()),
      } });
      return { paymentId: result.source_id, outstanding: result.outstanding };
    }
    if (paymentData.bankAccountId) throw new Error('Selected bank accounts require native accounting');
    const { data: paymentId, error } = await supabase.rpc('record_payment_atomic', {
      p_business_id: businessId,
      p_invoice_id: paymentData.invoiceId,
      p_customer_id: paymentData.customerId || null,
      p_amount: decimalInput(paymentData.amount),
      p_payment_method: paymentData.method,
      p_reference: paymentData.reference || `CACU-${paymentData.requestKey || randomUUID()}`
    });

    if (error) {
      const message = `Payment Integrity Error: ${error.message || 'Transaction rolled back'}`;
      // Validation/constraint SQL failures roll back; transport failures may be ambiguous.
      if (/^(22|23)/.test(error.code || '') || ['P0001', '42501'].includes(error.code)) throw new AccountingRequestError(message, 400);
      throw new Error(message);
    }

    // Trigger Notification
    const notificationService = new NotificationService();
    await notificationService.trigger({
      title: 'Payment Received',
      message: `₦${paymentData.amount.toLocaleString()} received via ${paymentData.method}.`,
      type: 'PAYMENT_RECEIVED',
      metadata: { paymentId, invoiceId: paymentData.invoiceId }
    }).catch(() => this.logInfo('Post-payment notification unavailable', { businessId, paymentId }));

    return { paymentId };
  }
}
