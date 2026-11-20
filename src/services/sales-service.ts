import { accountingRequest, decimalInput, usesPythonAccounting } from '@/lib/accounting-client';
import { randomUUID } from 'node:crypto';
import { BaseService } from './base-service';
import { NotificationService } from './notification-service';
import { logger } from '@/lib/logger';
import { READ_ONLY_MESSAGE, isReadOnlyRefusal } from '@/lib/read-only';
import { PERMISSION_MESSAGE, isPermissionRefusal } from '@/lib/permission';

/**
 * @fileOverview SalesService handles POS checkouts and atomic retail operations.
 */
export type SaleResult = { saleId: string; status?: 'completed' | 'pending_payment' | 'credit'; change?: string | null;
  invoice_number?: string; shortfalls?: { item_id: string; quantity: number }[]; deposit_applied?: string; paid_now?: string };

export class SalesService extends BaseService {
  async processCheckout(input: {
    items: { id: string; quantity: number; price: number; name: string; discountPercent?: string }[];
    paymentMethod: 'Cash' | 'Card' | 'Transfer' | 'Split' | 'Credit';
    cashReceived?: string;
    transferAmount?: string;
    totalAmount: number;
    customerId?: string;
    requestKey?: string;
    bankAccountId?: string;
    bookingId?: string;
    jobId?: string;
  }) {
    const startTime = Date.now();
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    if (await usesPythonAccounting()) return accountingRequest<SaleResult>('sales', { method: 'POST', body: {
      request_key: input.requestKey || randomUUID(),
      items: input.items.map(item => ({ item_id: item.id, quantity: item.quantity, discount_percent: item.discountPercent || '0' })),
      quoted_total: decimalInput(input.totalAmount), method: input.paymentMethod,
      bank_account_id: input.bankAccountId || null,
      cash_received: input.cashReceived || null, transfer_amount: input.transferAmount || null,
      customer_id: input.paymentMethod === 'Credit' ? input.customerId || null : null,
      booking_id: input.bookingId || null,
      job_id: input.jobId || null,
      entry_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date()),
    } });
    if (input.bankAccountId) throw new Error('Selected bank accounts require native accounting');
    if (!['Cash', 'Card', 'Transfer'].includes(input.paymentMethod) || input.items.some(item => Number(item.discountPercent || 0) > 0))
      throw new Error('Split and credit sales and discounts need your books turned on');
    const { data, error } = await supabase.rpc('process_sale_safe', {
      p_business_id: businessId,
      p_customer_id: input.customerId || null,
      p_items: input.items.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: decimalInput(item.price)
      })),
      p_payment_method: input.paymentMethod,
      p_total_amount: decimalInput(input.totalAmount),
      p_request_key: input.requestKey || randomUUID()
    });

    const duration = Date.now() - startTime;
    logger.perf('Process Sale', duration, { businessId, itemCount: input.items.length }, this.serviceName);

    if (error) {
      this.logError('Checkout Failed', error, { input, businessId });
      if (isReadOnlyRefusal(error)) throw new Error(READ_ONLY_MESSAGE);
      if (isPermissionRefusal(error)) throw new Error(PERMISSION_MESSAGE);
      if (error.message.includes('Insufficient stock')) {
          throw new Error(`Inventory Error: ${error.message}`);
      }
      throw new Error(`Checkout Error: ${error.message || 'Atomic transaction failed'}`);
    }

    this.logInfo('Sale Processed Successfully', { saleId: data, businessId });

    // Post-Sale Operations
    void this.checkInventoryThresholds(input.items).catch(() => this.logInfo('Post-sale notification unavailable', { businessId }));

    return { saleId: data as string, status: 'completed' as const };
  }

  private async checkInventoryThresholds(soldItems: { id: string }[]) {
    const { supabase, businessId } = await this.getContext();
    const notificationService = new NotificationService();

    for (const item of soldItems) {
      const { data: updatedItem } = await supabase
        .from('catalog_items')
        .select('name, stock_quantity, reorder_level, item_type, track_stock, is_active')
        .eq('id', item.id)
        .eq('business_id', businessId)
        .single();

      if (updatedItem && updatedItem.item_type === 'PRODUCT' && updatedItem.track_stock !== false && updatedItem.is_active && updatedItem.stock_quantity <= updatedItem.reorder_level) {
        await notificationService.trigger({
          title: 'Low Stock Alert',
          message: `${updatedItem.name} has dropped to ${updatedItem.stock_quantity} units. Please restock soon.`,
          type: 'LOW_STOCK',
          metadata: { itemId: item.id, currentQty: updatedItem.stock_quantity }
        });
      }
    }
  }

  async getRecentSales() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('transactions')
      .select('*, customers(name)')
      .eq('customers.business_id', businessId)
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
