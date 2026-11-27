import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PayrollBooksPanel } from '@/components/hr/payroll-books';
import { payrollBooksAction, postPayrollAction, settlePayrollAction } from '@/app/hr/payroll/books-actions';
import type { PayrollBooks, PayrollBooksRun } from '@/lib/payroll-books';

jest.mock('@/app/hr/payroll/books-actions', () => ({ payrollBooksAction: jest.fn(), postPayrollAction: jest.fn(), settlePayrollAction: jest.fn() }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => '3a571056-45cf-4239-96bb-331e35c39b65' });

const RUN = '7d3c9a57-1b0e-4c64-9a52-5e1f4f2f0a11';
const totals = { id: RUN, period: '2026-11-01', status: 'approved', employee_count: 3, gross_total: 500000, net_total: 420000, paye_total: 40000,
  pension_employee_total: 32000, pension_employer_total: 40000, nhf_total: 5000, nhis_total: 3000 };
const unposted: PayrollBooksRun = { run: totals, posted: null, outstanding: null, settlements: [] };
const posted: PayrollBooksRun = { run: totals, posted: { entry_date: '2026-11-26', posted_at: '2026-11-26T10:00:00Z', transaction_id: 41 },
  outstanding: { net_pay: '420000.00', paye: '40000.00', pension: '72000.00', nhf: '0.00', nhis: '3000.00' }, settlements: [] };
const books = (run: PayrollBooksRun): PayrollBooks => ({ enabled: true, message: null, runs: [run], pay_from: { cash: true, banks: [{ id: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10', name: 'GTBank' }] } });

beforeEach(() => jest.clearAllMocks());

test('R4 gate: nothing shows while payroll posting is off, or to someone without payroll.approve', async () => {
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: true, data: { enabled: false, message: 'Posting payroll to the books is not available yet.', runs: [], pay_from: { cash: false, banks: [] } } });
  const first = render(<PayrollBooksPanel runId={RUN} />);
  await waitFor(() => expect(payrollBooksAction).toHaveBeenCalled());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  first.unmount();
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: false, error: 'You do not have permission to do this in this business. Ask the business owner.' });
  render(<PayrollBooksPanel runId={RUN} />);
  await waitFor(() => expect(payrollBooksAction).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('FR-203: an approved run is posted by its own step, then shows what is still to pay', async () => {
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: true, data: books(unposted) });
  (postPayrollAction as jest.Mock).mockResolvedValue({ success: true, data: posted });
  render(<PayrollBooksPanel runId={RUN} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Post to the books' }));
  expect(await screen.findByText('Posted to the books on 2026-11-26.')).toBeInTheDocument();
  expect(postPayrollAction).toHaveBeenCalledWith(RUN, '3a571056-45cf-4239-96bb-331e35c39b65');
  expect(screen.getByText('Net pay to staff', { selector: 'td' }).nextElementSibling).toHaveTextContent('₦420,000.00');
  expect(screen.getByText('Pension to the pension fund administrators', { selector: 'td' }).nextElementSibling).toHaveTextContent('₦72,000.00');
});

test('paying staff from a bank records the payment against the run; nothing already paid is offered', async () => {
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: true, data: books(posted) });
  (settlePayrollAction as jest.Mock).mockResolvedValue({ success: true, data: { ...posted,
    outstanding: { ...posted.outstanding!, net_pay: '20000.00' },
    settlements: [{ id: 's1', kind: 'net_pay', label: 'Net pay to staff', amount: '400000.00', entry_date: '2026-11-26', paid_from: 'GTBank', reference: 'Nov salaries' }] } });
  render(<PayrollBooksPanel runId={RUN} />);
  const what = await screen.findByLabelText('What you paid');
  expect([...(what as HTMLSelectElement).options].map(o => o.value)).toEqual(['net_pay', 'paye', 'pension', 'nhis']);  // NHF is paid
  fireEvent.change(screen.getByLabelText('Amount (₦)'), { target: { value: '400000' } });
  fireEvent.change(screen.getByLabelText('Paid from'), { target: { value: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10' } });
  fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'Nov salaries' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByText(/Net pay to staff from GTBank \(Nov salaries\)/)).toBeInTheDocument();
  expect(settlePayrollAction).toHaveBeenCalledWith(RUN, '3a571056-45cf-4239-96bb-331e35c39b65', expect.objectContaining({
    kind: 'net_pay', amount: '400000', method: 'Transfer', bank_account_id: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10', reference: 'Nov salaries' }));
  expect(screen.getByText('Net pay to staff', { selector: 'td' }).nextElementSibling).toHaveTextContent('₦20,000.00');
});

test('a refused payment shows why and keeps what was typed', async () => {
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: true, data: books(posted) });
  (settlePayrollAction as jest.Mock).mockResolvedValue({ success: false, error: 'Only ₦420,000.00 is still owed for this.' });
  render(<PayrollBooksPanel runId={RUN} />);
  fireEvent.change(await screen.findByLabelText('Amount (₦)'), { target: { value: '500000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Only ₦420,000.00 is still owed');
  expect(screen.getByLabelText('Amount (₦)')).toHaveValue('500000');
});

test('once net pay is paid in full, the next payment is for something still owed', async () => {
  const paid = { ...posted, outstanding: { ...posted.outstanding!, net_pay: '0.00' } };
  (payrollBooksAction as jest.Mock).mockResolvedValue({ success: true, data: books(paid) });
  (settlePayrollAction as jest.Mock).mockResolvedValue({ success: true, data: paid });
  render(<PayrollBooksPanel runId={RUN} />);
  const what = await screen.findByLabelText('What you paid');
  expect((what as HTMLSelectElement).value).toBe('paye');
  fireEvent.change(screen.getByLabelText('Amount (₦)'), { target: { value: '40000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByText('Posted to the books on 2026-11-26.');
  expect(settlePayrollAction).toHaveBeenCalledWith(RUN, expect.any(String), expect.objectContaining({ kind: 'paye', amount: '40000' }));
});
