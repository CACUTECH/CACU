
import { BaseService } from './base-service';

/**
 * @fileOverview PaymentService handles collection and ledger synchronization.
 * Uses record_payment_atomic RPC to update invoice status and decrement inventory.
 */
export class PaymentService extends BaseService {
  /**
   * Records a payment atomically.
   * 1. Updates Invoice to 'Paid'
   * 2. Records Payment Detail
   * 3. Syncs Financial Ledger
   * 4. Decrements Inventory for Product items
   */
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
      console.error('Payment Processing Failed:', error);
      throw new Error(`Payment Integrity Error: ${error.message || 'Transaction rolled back'}`);
    }

    return { paymentId };
  }
}
