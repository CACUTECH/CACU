
import { BaseService } from './base-service';

export class PaymentService extends BaseService {
  async recordPayment(paymentData: {
    invoiceId: string;
    customerId?: string;
    amount: number;
    method: string;
    reference?: string;
  }) {
    const { supabase, businessId, user } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    // 1. Record the payment
    const { data: payment, error: payError } = await supabase
      .from('payments')
      .insert({
        business_id: businessId,
        invoice_id: paymentData.invoiceId,
        customer_id: paymentData.customerId,
        amount: paymentData.amount,
        payment_method: paymentData.method,
        reference: paymentData.reference
      })
      .select()
      .single();

    if (payError) throw payError;

    // 2. Update Invoice status
    await supabase
      .from('invoices')
      .update({ status: 'Paid', updated_at: new Date().toISOString() })
      .eq('id', paymentData.invoiceId);

    // 3. Sync to Ledger
    await supabase
      .from('financial_transactions')
      .insert({
        business_id: businessId,
        description: `Payment for Invoice #${paymentData.invoiceId.substring(0,8)}`,
        amount: paymentData.amount,
        type: 'Income',
        category: 'Invoices',
        reference_id: paymentData.invoiceId,
        created_by: user.id
      });

    return payment;
  }
}
