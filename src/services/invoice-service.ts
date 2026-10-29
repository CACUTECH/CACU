
import { accountingRequest, decimalInput, usesPythonAccounting } from '@/lib/accounting-client';
import { randomUUID } from 'node:crypto';
import { BaseService } from './base-service';

export type InvoiceInput = {
  requestKey?: string; customer_id: string | null; invoice_number: string; type: string; status: string;
  date: string; due_date?: string; subtotal: number | string; tax?: number | string; total: number | string;
  vat_included?: boolean; notes?: string;
};
export type InvoiceLineInput = { item: string; catalog_item_id?: string | null; quantity: number; price: number | string; total: number | string };

/**
 * @fileOverview InvoiceService manages multi-tenant billing documents.
 * Ensures that headers and line items are created atomically.
 */
const INVOICE_STATUS_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners, Admins and Editors can change invoice status.',
  INVOICE_NOT_FOUND: 'This invoice is not in your active business.',
  INVALID_STATUS_TRANSITION: 'This invoice status change is not allowed.',
  INVOICE_HAS_PAYMENTS: 'An invoice with payments cannot be voided.',
  USE_ACCOUNTING_POSTINGS: 'Posted invoices require payment allocation or audited credit notes; direct status changes are disabled',
};

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

  async createInvoice(invoiceData: InvoiceInput, items: InvoiceLineInput[]) {
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

  /** Only draft -> sent and unpaid -> void are allowed (update_invoice_status_safe); payments set paid. */
  async updateInvoiceStatus(id: string, status: string) {
    if (status === 'Accepted') throw new Error('Accepting estimates is not available yet.');
    if (status !== 'sent' && status !== 'void') throw new Error('This invoice status change is not allowed.');
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');
    if (await usesPythonAccounting()) throw new Error('Posted invoices require payment allocation or audited credit notes; direct status changes are disabled');
    const { data, error } = await supabase.rpc('update_invoice_status_safe', { p_business_id: businessId, p_invoice_id: id, p_status: status });
    if (error) {
      const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
      throw new Error(INVOICE_STATUS_MESSAGES[code] || 'The invoice status could not be changed.');
    }
    return data;
  }
}
