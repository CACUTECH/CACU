import { BaseService } from './base-service';
import { NotificationService } from './notification-service';
import { logger } from '@/lib/logger';

/**
 * @fileOverview SalesService handles POS checkouts and atomic retail operations.
 */
export class SalesService extends BaseService {
  async processCheckout(input: {
    items: { id: string; quantity: number; price: number; name: string }[];
    paymentMethod: 'Cash' | 'Card' | 'Transfer';
    totalAmount: number;
    customerId?: string;
  }) {
    const startTime = Date.now();
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

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

    const duration = Date.now() - startTime;
    logger.perf('Process Sale', duration, { businessId, itemCount: input.items.length }, this.serviceName);

    if (error) {
      this.logError('Checkout Failed', error, { input, businessId });
      if (error.message.includes('Insufficient stock')) {
          throw new Error(`Inventory Error: ${error.message}`);
      }
      throw new Error(`Checkout Error: ${error.message || 'Atomic transaction failed'}`);
    }

    this.logInfo('Sale Processed Successfully', { saleId: data, businessId });

    // Post-Sale Operations
    this.checkInventoryThresholds(input.items);

    return { saleId: data };
  }

  private async checkInventoryThresholds(soldItems: any[]) {
    const { supabase, businessId } = await this.getContext();
    const notificationService = new NotificationService();

    for (const item of soldItems) {
      const { data: updatedItem } = await supabase
        .from('catalog_items')
        .select('name, quantity, reorder_level')
        .eq('id', item.id)
        .single();

      if (updatedItem && updatedItem.quantity <= updatedItem.reorder_level) {
        await notificationService.trigger({
          title: 'Low Stock Alert',
          message: `${updatedItem.name} has dropped to ${updatedItem.quantity} units. Please restock soon.`,
          type: 'LOW_STOCK',
          metadata: { itemId: item.id, currentQty: updatedItem.quantity }
        });
      }
    }
  }

  async getRecentSales() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('sales')
      .select('*, customers(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      this.logError('Get Recent Sales Failed', error, { businessId });
      throw error;
    }
    return data;
  }
}
