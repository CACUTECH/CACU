
import { BaseService } from './base-service';

/**
 * @fileOverview SalesService handles POS checkouts and atomic retail operations.
 * Leverages PostgreSQL functions to ensure inventory and ledger consistency.
 */
export class SalesService extends BaseService {
  async processCheckout(input: {
    items: { id: string; quantity: number; price: number }[];
    paymentMethod: 'Cash' | 'Card' | 'Transfer';
    totalAmount: number;
    customerId?: string;
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    // Execute atomic RPC
    const { data, error } = await supabase.rpc('process_sale', {
      p_business_id: businessId,
      p_customer_id: input.customerId || null,
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_total_amount: input.totalAmount
    });

    if (error) {
      console.error('POS Checkout Failed:', error);
      throw new Error(`Checkout Error: ${error.message}`);
    }

    return { saleId: data };
  }

  async getRecentSales() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('sales')
      .select('*, customers(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    return data;
  }
}
