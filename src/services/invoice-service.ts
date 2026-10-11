
import { accountingRequest, decimalInput, usesPythonAccounting } from '@/lib/accounting-client';
import { randomUUID } from 'node:crypto';
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
      .eq('customers.business_id', businessId)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async listBalances(): Promise<{ id: string; total: string; outstanding: string }[]> {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];
    const { data, error } = await supabase.rpc('legacy_invoice_balances', { p_business_id: businessId });
    if (error) throw error;
    return data || [];
  }

  async createInvoice(invoiceData: any, items: any[]) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    if (await usesPythonAccounting()) {
      if (invoiceData.type !== 'Invoice') throw new Error('Use the issued-invoice allocation workflow for receipts and credit notes');
      return accountingRequest<{ id: string }>('invoices', { method: 'POST', body: {
        request_key: invoiceData.requestKey || randomUUID(), customer_id: invoiceData.customer_id,
        invoice_number: invoiceData.invoice_number, entry_date: invoiceData.date, due_date: invoiceData.due_date || null,
        notes: invoiceData.notes || '', tax: decimalInput(invoiceData.tax || 0), issue: invoiceData.status !== 'Draft',
        items: items.map(item => ({ catalog_item_id: item.catalog_item_id, quantity: item.quantity, unit_price: decimalInput(item.price) })),
      } });
    }
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
    
    if (await usesPythonAccounting()) throw new Error('Posted invoices require payment allocation or audited credit notes; direct status changes are disabled');
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
