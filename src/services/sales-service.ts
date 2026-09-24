
import { BaseService } from './base-service';

/**
 * @fileOverview SalesService handles POS checkouts and atomic retail operations.
 * Leverages PostgreSQL functions (process_sale) to ensure inventory and ledger consistency.
 */
export class SalesService extends BaseService {
  /**
   * Processes a retail checkout atomically.
   * Ensures stock validation, sale record, line items, and ledger entry occur as one unit.
   */
  async processCheckout(input: {
    items: { id: string; quantity: number; price: number; name: string }[];
    paymentMethod: 'Cash' | 'Card' | 'Transfer';
    totalAmount: number;
    customerId?: string;
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    // Execute atomic RPC for High-Integrity Transaction
    const { data, error } = await supabase.rpc('process_sale', {
      p_business_id: businessId,
      p_customer_id: input.customerId || null,
      p_items: input.items.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price
      })),
      p_payment_method: input.paymentMethod,
      p_total_amount: input.totalAmount
    });

    if (error) {
      console.error('POS Checkout Failed:', error);
      // Hardened error responses for financial clarity
      if (error.message.includes('Insufficient stock')) {
          throw new Error(`Inventory Error: ${error.message}`);
      }
      throw new Error(`Checkout Error: ${error.message || 'Atomic transaction failed'}`);
    }

    return { saleId: data };
  }

  /**
   * Fetches recent sales with customer details.
   */
  async getRecentSales() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('sales')
      .select('*, customers(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data;
  }
}
