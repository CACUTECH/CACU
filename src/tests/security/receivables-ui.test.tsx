import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerPaymentDialog } from '@/components/customer-payment-dialog';
import { ApplyAdvanceDialog } from '@/components/apply-advance-dialog';
import AgeingPage from '@/app/analytics/aging-reports/page';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { ageingAction, applyAdvanceAction, customerOpenItemsAction, recordCustomerPaymentAction } from '@/app/invoices/receivables-actions';
import { splitOldestFirst, type OpenInvoice } from '@/lib/receivables';

jest.mock('@/app/invoices/receivables-actions', () => ({ customerOpenItemsAction: jest.fn(), recordCustomerPaymentAction: jest.fn(), applyAdvanceAction: jest.fn(),
  refundAdvanceAction: jest.fn(), customerStatementAction: jest.fn(), ageingAction: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.setTimeout(20000);
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'key-1' });

const open = (id: string, number: string, amount: string, waiting = '0.00'): OpenInvoice => ({ id, invoice_number: number, issue_date: '2026-10-01', due_date: '2026-10-15',
  total: amount, outstanding: amount, waiting, open: (Number(amount) - Number(waiting)).toFixed(2) });
const items = { customer: { id: 'ada', name: 'Ada Provisions' }, invoices: [open('i1', 'INV-1', '60000.00'), open('i2', 'INV-2', '65000.00'), open('i3', 'INV-3', '65000.00')],
  open_total: '190000.00', advance: '0.00' };

beforeEach(() => {
  jest.clearAllMocks();
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (customerOpenItemsAction as jest.Mock).mockResolvedValue({ success: true, data: items });
});

test('a payment is split oldest first, the rest is kept as an advance, and the split can be changed', async () => {
  expect(splitOldestFirst('100000', items.invoices)).toEqual({ i1: '60000.00', i2: '40000.00', i3: '' });
  (recordCustomerPaymentAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'key-1', status: 'posted', amount: '200000.00', allocated: '175000.00', advance: '25000.00' } });
  const saved = jest.fn();
  render(<CustomerPaymentDialog open customers={[{ id: 'ada', name: 'Ada Provisions' }]} customerId="ada" onClose={jest.fn()} onSaved={saved} />);
  await userEvent.type(await screen.findByLabelText('Amount received (NGN)'), '200000');
  expect(screen.getByLabelText('Pay on INV-3')).toHaveValue('65000.00');
  expect(screen.getByText(/Kept as advance/)).toHaveTextContent('₦10,000.00');
  await userEvent.clear(screen.getByLabelText('Pay on INV-3'));
  await userEvent.type(screen.getByLabelText('Pay on INV-3'), '70000');
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(screen.getByRole('alert')).toHaveTextContent('INV-3: at most ₦65,000.00 is still owed.');
  await userEvent.clear(screen.getByLabelText('Pay on INV-3'));
  await userEvent.type(screen.getByLabelText('Pay on INV-3'), '50000');
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  await waitFor(() => expect(recordCustomerPaymentAction).toHaveBeenCalledWith(expect.objectContaining({ request_key: 'key-1', customer_id: 'ada', amount: '200000',
    method: 'Cash', bank_account_id: null, allocations: [{ invoice_id: 'i1', amount: '60000.00' }, { invoice_id: 'i2', amount: '65000.00' }, { invoice_id: 'i3', amount: '50000' }] })));
  expect(saved).toHaveBeenCalledWith('Payment of ₦200,000.00 recorded. ₦25,000.00 kept as Ada Provisions\'s advance.');
});

test('a transfer needs its bank account, and an unconfirmed answer keeps the same details for a retry', async () => {
  (recordCustomerPaymentAction as jest.Mock).mockResolvedValue({ success: false, error: 'The change was not confirmed.', uncertain: true });
  render(<CustomerPaymentDialog open customers={[{ id: 'ada', name: 'Ada Provisions' }]} customerId="ada" onClose={jest.fn()} onSaved={jest.fn()} />);
  await userEvent.type(await screen.findByLabelText('Amount received (NGN)'), '60000');
  await userEvent.selectOptions(screen.getByLabelText('Payment method'), 'Transfer');
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the bank account the transfer went to.');
  expect(recordCustomerPaymentAction).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getAllByRole('combobox').at(-1)!, 'gtb');
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByRole('button', { name: 'Retry payment' })).toBeInTheDocument();
  expect(screen.getByLabelText('Amount received (NGN)')).toBeDisabled();
  expect(recordCustomerPaymentAction).toHaveBeenCalledWith(expect.objectContaining({ method: 'Transfer', bank_account_id: 'gtb', allocations: [{ invoice_id: 'i1', amount: '60000.00' }] }));
});

test('an advance pays at most what is held and what is owed', async () => {
  (customerOpenItemsAction as jest.Mock).mockResolvedValue({ success: true, data: { ...items, advance: '25000.00', invoices: [open('i3', 'INV-3', '15000.00')] } });
  (applyAdvanceAction as jest.Mock).mockResolvedValue({ success: true, data: { outstanding: '0.00', advance: '10000.00' } });
  const saved = jest.fn();
  render(<ApplyAdvanceDialog invoice={{ id: 'i3', invoice_number: 'INV-3', customer_id: 'ada' }} onClose={jest.fn()} onSaved={saved} />);
  expect(await screen.findByLabelText('Amount to apply (NGN)')).toHaveValue('15000.00');
  await userEvent.click(screen.getByRole('button', { name: 'Apply advance' }));
  await waitFor(() => expect(applyAdvanceAction).toHaveBeenCalledWith('i3', 'key-1', '15000.00'));
  expect(saved).toHaveBeenCalledWith('₦15,000.00 of the advance applied to INV-3. Still owed: ₦0.00.');
});

test('ageing lists each customer by how late their invoices are and switches to suppliers', async () => {
  const buckets = [{ key: 'current', label: 'Not yet due' }, { key: 'd1_30', label: '1 to 30 days' }, { key: 'd31_60', label: '31 to 60 days' },
    { key: 'd61_90', label: '61 to 90 days' }, { key: 'over_90', label: 'Over 90 days' }];
  (ageingAction as jest.Mock).mockImplementation(async (type: string) => ({ success: true, data: { type, as_of: '2026-11-09', buckets, totals: { current: '0.00', d1_30: '60000.00',
    d31_60: '0.00', d61_90: '0.00', over_90: '65000.00', total: '125000.00', advance: '0.00', net: '125000.00' },
    rows: type === 'receivables' ? [{ party_id: 'ada', name: 'Ada Provisions', current: '0.00', d1_30: '60000.00', d31_60: '0.00', d61_90: '0.00', over_90: '65000.00',
      total: '125000.00', advance: '0.00', net: '125000.00', documents: [{ id: 'i9', number: 'INV-9', date: '2026-07-01', due_date: '2026-07-01', days_overdue: 131, bucket: 'over_90', outstanding: '65000.00' }] }] : [] } }));
  render(<AgeingPage />);
  expect(await screen.findByRole('button', { name: 'Ada Provisions' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Statement' })).toHaveAttribute('href', '/invoices/statement?customer=ada');
  await userEvent.click(screen.getByRole('button', { name: 'Ada Provisions' }));
  expect(screen.getByText(/INV-9: ₦65,000.00 owed, dated 2026-07-01, due 2026-07-01, 131 days late/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'You owe suppliers' }));
  expect(await screen.findByText(/Nothing is owed to suppliers/)).toBeInTheDocument();
  expect(ageingAction).toHaveBeenLastCalledWith('payables', expect.any(String));
});
