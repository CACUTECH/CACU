import { SalesService } from '@/services/sales-service';
import { PaymentService } from '@/services/payment-service';
import { accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
jest.mock('@/lib/accounting-client', () => ({ accountingRequest: jest.fn(), usesPythonAccounting: jest.fn(), decimalInput: (value: number | string) => Number(value).toFixed(2) }));
beforeEach(() => { (usesPythonAccounting as jest.Mock).mockResolvedValue(true); (accountingRequest as jest.Mock).mockReset(); });
function scoped(service: object) { Object.assign(service, { getContext: jest.fn().mockResolvedValue({ businessId: 'business', supabase: { rpc: jest.fn() } }) }); }

test('native receipt transports the selected bank and stable key', async () => {
  const service = new PaymentService(); scoped(service);
  (accountingRequest as jest.Mock).mockResolvedValue({ source_id: 'receipt', outstanding: '60.00' });
  await service.recordPayment({ invoiceId: 'invoice', amount: '40.00', method: 'Transfer', bankAccountId: 'bank', requestKey: 'stable' });
  expect(accountingRequest).toHaveBeenCalledWith('receipts', expect.objectContaining({ body: expect.objectContaining({ request_key: 'stable', bank_account_id: 'bank', method: 'Transfer' }) }));
});
test('native checkout transports the selected bank and cash sends no selected bank', async () => {
  const service = new SalesService(); scoped(service);
  const sale = { requestKey: 'stable', items: [{ id: 'sku', name: 'Goods', quantity: 1, price: 100 }], totalAmount: 100 };
  await service.processCheckout({ ...sale, paymentMethod: 'Transfer', bankAccountId: 'bank' });
  expect(accountingRequest).toHaveBeenLastCalledWith('sales', expect.objectContaining({ body: expect.objectContaining({ bank_account_id: 'bank', quoted_total: '100.00' }) }));
  await service.processCheckout({ ...sale, paymentMethod: 'Cash' });
  expect(accountingRequest).toHaveBeenLastCalledWith('sales', expect.objectContaining({ body: expect.objectContaining({ bank_account_id: null }) }));
});
test('native collection errors never fall back to legacy', async () => {
  const service = new PaymentService(); scoped(service);
  (accountingRequest as jest.Mock).mockRejectedValue(new Error('Bank unavailable'));
  await expect(service.recordPayment({ invoiceId: 'invoice', amount: '40.00', method: 'Transfer', bankAccountId: 'bank' })).rejects.toThrow('Bank unavailable');
});
test('legacy mode rejects supplied bank selection instead of ignoring it', async () => {
  (usesPythonAccounting as jest.Mock).mockResolvedValue(false);
  const service = new PaymentService(); scoped(service);
  await expect(service.recordPayment({ invoiceId: 'invoice', amount: '40.00', method: 'Transfer', bankAccountId: 'bank' })).rejects.toThrow('Selected bank accounts require native accounting');
});
test('eligible bank accounts come from the native API and legacy mode has none', async () => {
  (accountingRequest as jest.Mock).mockResolvedValue([{ id: 'bank', name: 'Receiving bank' }]);
  await expect(getCollectionAccountsAction()).resolves.toEqual({ native: true, accounts: [{ id: 'bank', name: 'Receiving bank' }] });
  (usesPythonAccounting as jest.Mock).mockResolvedValue(false);
  await expect(getCollectionAccountsAction()).resolves.toEqual({ native: false, accounts: [] });
});
