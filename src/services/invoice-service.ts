
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
const INVOICE_CREATE_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: 'Only Owners, Admins and Editors can create invoices.',
  UNSUPPORTED_DOCUMENT: 'Only invoices and estimates can be created here. Record a payment on an invoice to issue a receipt.',
  TAX_NOT_CONFIGURED: 'Tax is not set up for this business yet. Create the invoice without VAT.',
  CUSTOMER_REQUIRED: 'Choose a customer for this invoice.',
  CUSTOMER_NOT_FOUND: 'This customer is not in your active business.',
  ITEM_NOT_FOUND: 'One of the items is not in your active catalogue.',
  INVALID_INVOICE: 'Add at least one item with a quantity above zero, and use an issue date that is not in the future and a due date on or after it.',
  REQUEST_KEY_REUSED: 'This invoice was already submitted with different details. Close the form and try again.',
  USE_ACCOUNTING_POSTINGS: 'Use the issued-invoice workflow for this business.',
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
    if (invoiceData.type !== 'Invoice' && invoiceData.type !== 'Estimate') throw new Error(INVOICE_CREATE_MESSAGES.UNSUPPORTED_DOCUMENT);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceData.requestKey || '')) {
      throw new Error('The invoice request was invalid. Refresh and try again.');
    }
    // create_invoice_safe sets status, number, prices and totals on the server; only item IDs and quantities are sent.
    const { data, error } = await supabase.rpc('create_invoice_safe', {
      p_business_id: businessId, p_request_key: invoiceData.requestKey, p_type: invoiceData.type,
      p_customer_id: invoiceData.customer_id, p_issue_date: invoiceData.date || null, p_due_date: invoiceData.due_date || null,
      p_vat_included: !!invoiceData.vat_included, p_notes: invoiceData.notes || '',
      p_items: items.map(item => ({ catalog_item_id: item.catalog_item_id || null, quantity: String(item.quantity) })),
    });
    if (error) {
      const code = /^[A-Z_]+/.exec(error.message || '')?.[0] || '';
      throw new Error(INVOICE_CREATE_MESSAGES[code] || 'The invoice was not confirmed. Retry to check whether it was created.');
    }
    return { id: (data as { id: string }).id };
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
