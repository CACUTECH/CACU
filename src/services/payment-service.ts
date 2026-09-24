
import { BaseService } from './base-service';
import { NotificationService } from './notification-service';

/**
 * @fileOverview PaymentService handles collection and ledger synchronization.
 */
export class PaymentService extends BaseService {
  async recordPayment(paymentData: {
    invoiceId: string;
    customerId?: string;
    amount: number;
    method: string;
    reference?: string;
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

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
