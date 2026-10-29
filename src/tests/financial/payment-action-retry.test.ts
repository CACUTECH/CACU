import { AccountingRequestError } from '@/lib/accounting-client';
import { markAsPaidAction } from '@/app/invoices/actions';
const mockRecord = jest.fn();
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/services/payment-service', () => ({ PaymentService: jest.fn().mockImplementation(() => ({ recordPayment: mockRecord })) }));

test.each([
  [new AccountingRequestError('Bank unavailable', 422), false],
  [new AccountingRequestError('Database unavailable', 503), true],
  [new Error('Response interrupted'), true],
])('payment action distinguishes definite rejection from ambiguous failure (%s)', async (error, retryable) => {
  mockRecord.mockRejectedValue(error);
  await expect(markAsPaidAction({ invoiceId: 'invoice', amount: '100', method: 'Cash' })).resolves.toEqual({ success: false, error: error.message, retryable });
});
