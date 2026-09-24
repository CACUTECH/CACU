
import { BaseService } from './base-service';

/**
 * @fileOverview PaymentService handles collection and ledger synchronization.
 * Updates invoice status and decrements inventory atomically upon payment.
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

    // Use atomic RPC to:
    // 1. Record payment
    // 2. Update Invoice to 'Paid'
    // 3. Record Financial Transaction (Income)
    // 4. Decrement Stock for product items on the invoice
    const { data: paymentId, error } = await supabase.rpc('record_payment_atomic', {
      p_business_id: businessId,
      p_invoice_id: paymentData.invoiceId,
      p_customer_id: paymentData.customerId || null,
      p_amount: paymentData.amount,
      p_payment_method: paymentData.method,
      p_reference: paymentData.reference || null
    });

    if (error) {
      console.error('Payment Processing Failed:', error);
      throw new Error(`Payment Error: ${error.message}`);
    }

    return { paymentId };
  }
}
