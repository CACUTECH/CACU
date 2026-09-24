
import { BaseService } from './base-service';

/**
 * @fileOverview InvoiceService manages multi-tenant billing documents.
 * Ensures that headers and line items are created atomically.
 */
export class InvoiceService extends BaseService {
  async listInvoices() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('invoices')
      .select('*, customers(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async createInvoice(invoiceData: any, items: any[]) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    // Use the atomic RPC to ensure header and items are created together
    const { data: invoiceId, error } = await supabase.rpc('create_invoice_atomic', {
      p_business_id: businessId,
      p_customer_id: invoiceData.customer_id,
      p_invoice_number: invoiceData.invoice_number,
      p_type: invoiceData.type,
      p_status: invoiceData.status,
      p_date: invoiceData.date,
      p_due_date: invoiceData.due_date,
      p_subtotal: invoiceData.subtotal,
      p_tax: invoiceData.tax,
      p_total: invoiceData.total,
      p_vat_included: invoiceData.vat_included,
      p_notes: invoiceData.notes,
      p_items: items.map(item => ({
        item_name: item.item,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.total,
        catalog_item_id: item.catalog_item_id // Essential for inventory sync on payment
      }))
    });

    if (error) {
       console.error('Invoice Creation Failed:', error);
       throw new Error(`Invoice Error: ${error.message}`);
    }

    return { id: invoiceId };
  }

  async updateInvoiceStatus(id: string, status: string) {
    const { supabase, businessId } = await this.getContext();
    
    const { data, error } = await supabase
      .from('invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
