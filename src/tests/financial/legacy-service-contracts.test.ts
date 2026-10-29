import { SalesService } from '@/services/sales-service';
import { PaymentService } from '@/services/payment-service';
import { InvoiceService } from '@/services/invoice-service';
import { NotificationService } from '@/services/notification-service';

jest.mock('@/lib/accounting-client', () => ({
  usesPythonAccounting: jest.fn().mockResolvedValue(false), accountingRequest: jest.fn(),
  decimalInput: (value: number | string) => Number(value).toFixed(2),
}));
jest.mock('@/services/notification-service', () => ({ NotificationService: jest.fn() }));

function context(service: object, rpc: jest.Mock) {
  Object.assign(service, { getContext: jest.fn().mockResolvedValue({ supabase: { rpc }, businessId: 'business' }) });
}

test('checkout retains the UI retry key and decimal quote after a committed sale', async () => {
  const service = new SalesService();
  const rpc = jest.fn().mockResolvedValue({ data: 'sale', error: null });
  context(service, rpc);
  Object.assign(service, { checkInventoryThresholds: jest.fn().mockRejectedValue(new Error('Notification unavailable')) });
  await expect(service.processCheckout({ requestKey: 'retry-key', items: [{ id: 'sku', name: 'Display name', price: 10, quantity: 1 }], paymentMethod: 'Cash', totalAmount: 10 })).resolves.toEqual({ saleId: 'sale' });
  expect(rpc).toHaveBeenCalledWith('process_sale_safe', expect.objectContaining({ p_request_key: 'retry-key', p_total_amount: '10.00', p_items: [expect.objectContaining({ price: '10.00' })] }));
});

test('receipt uses the same durable reference on retries and survives notification failure', async () => {
  const service = new PaymentService();
  const rpc = jest.fn().mockResolvedValue({ data: 'payment', error: null });
  context(service, rpc);
  (NotificationService as jest.Mock).mockImplementation(() => ({ trigger: jest.fn().mockRejectedValue(new Error('Notification unavailable')) }));
  const receipt = { invoiceId: 'invoice', amount: '40.00', method: 'Cash', requestKey: 'retry-key' };
  await expect(service.recordPayment(receipt)).resolves.toEqual({ paymentId: 'payment' });
  await service.recordPayment(receipt);
  expect(rpc).toHaveBeenNthCalledWith(2, 'record_payment_atomic', expect.objectContaining({ p_reference: 'CACU-retry-key', p_amount: '40.00' }));
});

test('legacy invoice balances preserve exact database decimals and fail on read errors', async () => {
  const service = new InvoiceService();
  const rpc = jest.fn().mockResolvedValue({ data: [{ id: 'invoice', total: '100', outstanding: '60' }], error: null });
  context(service, rpc);
  await expect(service.listBalances()).resolves.toEqual([{ id: 'invoice', total: '100', outstanding: '60' }]);
  expect(rpc).toHaveBeenCalledWith('legacy_invoice_balances', { p_business_id: 'business' });
  rpc.mockResolvedValue({ data: null, error: new Error('Read failed') });
  await expect(service.listBalances()).rejects.toThrow('Read failed');
});

describe('legacy invoice creation', () => {
  const key = '11111111-2222-4333-8444-555555555555';
  const header = { requestKey: key, customer_id: 'customer', invoice_number: 'client-number', type: 'Invoice', status: 'Paid',
    date: '2026-10-29', subtotal: 1, tax: 0, total: 1, vat_included: false, notes: '' };
  const line = { item: 'Rice', catalog_item_id: 'rice', quantity: 2, price: 1, total: 2 };

  test('sends only item IDs and quantities; status, number, prices and totals come from the server', async () => {
    const service = new InvoiceService();
    const rpc = jest.fn().mockResolvedValue({ data: { id: 'invoice', status: 'sent' }, error: null });
    context(service, rpc);
    await expect(service.createInvoice(header, [line])).resolves.toEqual({ id: 'invoice' });
    expect(rpc).toHaveBeenCalledWith('create_invoice_safe', {
      p_business_id: 'business', p_request_key: key, p_type: 'Invoice', p_customer_id: 'customer', p_issue_date: '2026-10-29',
      p_due_date: null, p_vat_included: false, p_notes: '', p_items: [{ catalog_item_id: 'rice', quantity: '2' }],
    });
  });

  test.each(['Receipt', 'CreditMemo'])('%s cannot be created as a standalone document', async type => {
    const service = new InvoiceService();
    const rpc = jest.fn();
    context(service, rpc);
    await expect(service.createInvoice({ ...header, type }, [line])).rejects.toThrow('Record a payment on an invoice');
    expect(rpc).not.toHaveBeenCalled();
  });

  test('database refusals show reviewed messages and other failures stay retryable', async () => {
    const service = new InvoiceService();
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'CUSTOMER_REQUIRED', code: '22023' } });
    context(service, rpc);
    await expect(service.createInvoice(header, [line])).rejects.toThrow('Choose a customer for this invoice.');
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset at 10.0.0.1', code: '08006' } });
    await expect(service.createInvoice(header, [line])).rejects.toThrow('The invoice was not confirmed. Retry to check whether it was created.');
  });

  test('a malformed request key is refused before calling the database', async () => {
    const service = new InvoiceService();
    const rpc = jest.fn();
    context(service, rpc);
    await expect(service.createInvoice({ ...header, requestKey: 'retry-key' }, [line])).rejects.toThrow('The invoice request was invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
});
