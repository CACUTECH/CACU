
import { BaseService } from './base-service';

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

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        ...invoiceData,
        business_id: businessId,
      })
      .select()
      .single();

    if (invError) throw invError;

    const invoiceItems = items.map(item => ({
      invoice_id: invoice.id,
      item_name: item.item,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.total
    }));

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItems);

    if (itemsError) throw itemsError;

    return invoice;
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
