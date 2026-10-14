import { LedgerService } from '@/services/ledger-service';
jest.mock('@/lib/accounting-client', () => ({ usesPythonAccounting: jest.fn().mockResolvedValue(false) }));

class TestLedgerService extends LedgerService { getContext = jest.fn(); }

function setup(pageData: unknown[] = [], total = 0, error: unknown = null) {
  const query = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), range: jest.fn().mockResolvedValue({ data: pageData, count: total, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  const from = jest.fn().mockReturnValue(query);
  const service = new TestLedgerService();
  service.getContext.mockResolvedValue({ businessId: 'authorized-tenant', supabase: { from } });
  return { service, query, from };
}

test('ledger pagination bounds the query with authorized tenant and deterministic ordering', async () => {
  const { service, query } = setup([{ id: 'saved' }], 21);
  await expect(service.listTransactionsPage(1)).resolves.toEqual({ data: [{ id: 'saved' }], total: 21 });
  expect(query.eq).toHaveBeenCalledWith('business_id', 'authorized-tenant');
  expect(query.range).toHaveBeenCalledWith(20, 39);
  expect(query.order.mock.calls).toEqual([['date', { ascending: false }], ['id', { ascending: false }]]);
});

test.each([-1, 1.5, NaN, Infinity, 100001])('invalid page %s never reaches the database', async page => {
  const { service, from } = setup();
  await expect(service.listTransactionsPage(page)).rejects.toThrow('Invalid ledger page');
  expect(from).not.toHaveBeenCalled();
});

test('read errors cannot be presented as empty financial results', async () => {
  const { service } = setup([], 0, { message: 'private database details' });
  await expect(service.listTransactionsPage()).rejects.toThrow('Ledger records unavailable');
});
