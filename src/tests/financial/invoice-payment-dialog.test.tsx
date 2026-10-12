import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvoicePaymentDialog } from '@/components/invoice-payment-dialog';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { markAsPaidAction } from '@/app/invoices/actions';
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('@/app/invoices/actions', () => ({ markAsPaidAction: jest.fn() }));
jest.mock('lucide-react', () => ({ X: () => null }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'stable-retry-key' });
const invoice = { id: 'invoice', invoice_number: 'INV-1', total: 100, outstanding: '60.00' };
beforeEach(() => { (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'bank', name: 'Receiving bank' }] }); (markAsPaidAction as jest.Mock).mockReset(); });

test('requires a selected bank for transfer and retains the original request after close/reopen', async () => {
  const saved = jest.fn(); const close = jest.fn();
  const { rerender } = render(<InvoicePaymentDialog invoice={invoice} onClose={close} onSaved={saved} />);
  await waitFor(() => expect(screen.getByLabelText('Payment method')).toBeInTheDocument());
  expect(screen.getByLabelText('Amount received (NGN)')).toHaveValue('60.00');
  fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Transfer' } });
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Receiving bank account'), { target: { value: 'bank' } });
  fireEvent.change(screen.getByLabelText('Amount received (NGN)'), { target: { value: '40.00' } });
  (markAsPaidAction as jest.Mock).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ success: true });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Payment response unavailable'));
  const first = (markAsPaidAction as jest.Mock).mock.calls[0][0];
  expect(first).toEqual(expect.objectContaining({ amount: '40.00', method: 'Transfer', bankAccountId: 'bank' }));
  rerender(<InvoicePaymentDialog invoice={null} onClose={close} onSaved={saved} />);
  rerender(<InvoicePaymentDialog invoice={invoice} onClose={close} onSaved={saved} />);
  await waitFor(() => expect(screen.getByLabelText('Amount received (NGN)')).toHaveValue('40.00'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled());
  expect(screen.getByLabelText('Amount received (NGN)')).toBeDisabled();
  expect(screen.getByLabelText('Receiving bank account')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry payment' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect((markAsPaidAction as jest.Mock).mock.calls[1][0]).toEqual(first);
});
test('no eligible accounts disables transfer and unavailable account loading fails closed', async () => {
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [] });
  const { unmount } = render(<InvoicePaymentDialog invoice={invoice} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Payment method')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Transfer' } });
  expect(screen.getByText(/No receiving bank accounts are available/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  unmount();
  (getCollectionAccountsAction as jest.Mock).mockRejectedValue(new Error('Unavailable'));
  render(<InvoicePaymentDialog invoice={invoice} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Payment accounts unavailable'));
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  expect(markAsPaidAction).not.toHaveBeenCalled();
});

test('a definite validation rejection allows correcting payment details with the same key', async () => {
  render(<InvoicePaymentDialog invoice={invoice} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Payment method')).toBeInTheDocument());
  (markAsPaidAction as jest.Mock).mockResolvedValue({ success: false, error: 'Amount exceeds outstanding balance', retryable: false });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Amount exceeds outstanding balance'));
  expect(screen.getByLabelText('Amount received (NGN)')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled();
});

test('a rejection on a later retry cannot erase an earlier uncertain payment', async () => {
  const { rerender } = render(<InvoicePaymentDialog invoice={invoice} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Payment method')).toBeInTheDocument());
  (markAsPaidAction as jest.Mock).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ success: false, error: 'Session expired', retryable: false });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled());
  const original = (markAsPaidAction as jest.Mock).mock.calls[0][0];
  fireEvent.click(screen.getByRole('button', { name: 'Retry payment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session expired'));
  expect(screen.getByLabelText('Amount received (NGN)')).toBeDisabled();
  rerender(<InvoicePaymentDialog invoice={null} onClose={jest.fn()} onSaved={jest.fn()} />);
  rerender(<InvoicePaymentDialog invoice={invoice} onClose={jest.fn()} onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Retry payment' }));
  await waitFor(() => expect(markAsPaidAction).toHaveBeenCalledTimes(3));
  expect((markAsPaidAction as jest.Mock).mock.calls[2][0]).toEqual(original);
});
