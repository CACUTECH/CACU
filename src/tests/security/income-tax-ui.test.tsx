import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncomeTaxPage from '@/app/accounting/income-tax/page';
import { addTaxAdjustmentAction, incomeTaxAction, payTaxAction, postTaxAction, reverseTaxAction, saveTaxYearAction, saveYearEndAction } from '@/app/accounting/income-tax/actions';
import type { IncomeTaxEstimate } from '@/lib/income-tax';

let mockRole = 'owner';
jest.mock('@/app/accounting/income-tax/actions', () => ({ incomeTaxAction: jest.fn(), saveTaxYearAction: jest.fn(), addTaxAdjustmentAction: jest.fn(), removeTaxAdjustmentAction: jest.fn(), saveYearEndAction: jest.fn(),
  postTaxAction: jest.fn(), payTaxAction: jest.fn(), reverseTaxAction: jest.fn(), bankAccountsAction: jest.fn().mockResolvedValue({ success: true, data: [] }) }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', userRole: mockRole } }) }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => '3a571056-45cf-4239-96bb-331e35c39b65' });

const base: IncomeTaxEstimate = { year: new Date().getFullYear(), small_company: false, not_small_because: ['turnover is above ₦50,000,000'],
  turnover: '60000000.00', fixed_assets: '1200000.00',
  steps: [{ label: 'Profit before tax, from the books', amount: '10000000.00' }, { label: 'Add: depreciation in the books', amount: '200000.00' },
    { label: 'Adjusted profit', amount: '10200000.00' }, { label: 'Assessable profit', amount: '10200000.00' }, { label: 'Less: capital allowances', amount: '-240000.00' },
    { label: 'Total profits', amount: '9960000.00' }],
  period: { start: `${new Date().getFullYear()}-01-01`, end: `${new Date().getFullYear()}-12-31`, year_end_month: 12 },
  wht: { credited: '0.00', used: '0.00', carried_forward: '0.00', awaiting_certificate: '0.00', awaiting_count: 0 }, income_tax_to_pay: '2988000.00',
  companies_income_tax: '2988000.00', development_levy: '408000.00', total_due: '3396000.00', cit_rate_percent: '30.00', levy_rate_percent: '4.00',
  small_turnover: '50000000.00', small_fixed_assets: '250000000.00', losses_carried_forward: '0.00', allowances_carried_forward: '0.00',
  told: { losses_brought_forward: '0.00', professional_services: false }, adjustments: [],
  books: { posted: null, payments: [], outstanding: null, reversed: [] }, reviewed: false, note: 'CACU does not file tax returns.' };

beforeEach(() => { jest.clearAllMocks(); mockRole = 'owner'; (incomeTaxAction as jest.Mock).mockResolvedValue({ success: true, data: base }); });

test('the estimate shows the tax, the levy and every step, marked for review', async () => {
  render(<IncomeTaxPage />);
  expect(await screen.findByText('₦3,396,000.00')).toBeInTheDocument();
  expect(screen.getByText(/Companies income tax ₦2,988,000.00 \(30% of total profits\)/)).toBeInTheDocument();
  expect(screen.getByText('Not a small company because turnover is above ₦50,000,000.')).toBeInTheDocument();
  expect(screen.getByText('Less: capital allowances')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('still to be confirmed by a tax professional');
});

test('a small company is told it pays nothing', async () => {
  (incomeTaxAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, small_company: true, turnover: '12000000.00', total_due: '0.00' } });
  render(<IncomeTaxPage />);
  expect(await screen.findByText(/A small company: no income tax or development levy/)).toBeInTheDocument();
});

test('an owner adds a fine back and records losses brought forward', async () => {
  (addTaxAdjustmentAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, adjustments: [{ id: 'a1', direction: 'add', label: 'LASG fine', amount: '1000000.00' }] } });
  (saveTaxYearAction as jest.Mock).mockResolvedValue({ success: true, data: base });
  render(<IncomeTaxPage />);
  fireEvent.change(await screen.findByLabelText('What it is'), { target: { value: 'LASG fine' } });
  fireEvent.change(screen.getByLabelText('Amount (₦)'), { target: { value: '1000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(screen.getByText(/Add back: LASG fine/)).toBeInTheDocument());
  expect(addTaxAdjustmentAction).toHaveBeenCalledWith(base.year, '3a571056-45cf-4239-96bb-331e35c39b65', { direction: 'add', label: 'LASG fine', amount: '1000000' });
  fireEvent.change(screen.getByLabelText('Losses brought forward (₦)'), { target: { value: '5000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveTaxYearAction).toHaveBeenCalledWith(base.year, { losses_brought_forward: '5000000', professional_services: false }));
});

test('viewers see the estimate but cannot change it', async () => {
  mockRole = 'viewer';
  render(<IncomeTaxPage />);
  expect(await screen.findByText('₦3,396,000.00')).toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Add an adjustment' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Losses brought forward (₦)')).not.toBeInTheDocument();
});

test('withholding tax credits come off, and those awaiting a credit note are listed', async () => {
  (incomeTaxAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, total_due: '2896000.00', income_tax_to_pay: '2488000.00',
    wht: { credited: '500000.00', used: '500000.00', carried_forward: '0.00', awaiting_certificate: '200000.00', awaiting_count: 1 } } });
  render(<IncomeTaxPage />);
  expect(await screen.findByText(/with credit notes\): ₦500,000.00, leaving income tax of ₦2,488,000.00/)).toBeInTheDocument();
  expect(screen.getByText(/₦200,000.00 of withholding tax on 1 invoice is waiting/)).toBeInTheDocument();
});

test('an owner sets a March year end and the estimate reloads', async () => {
  (saveYearEndAction as jest.Mock).mockResolvedValue({ success: true });
  render(<IncomeTaxPage />);
  fireEvent.change(await screen.findByLabelText('Your accounts end in'), { target: { value: '3' } });
  await waitFor(() => expect(incomeTaxAction).toHaveBeenCalledTimes(2));
  expect(saveYearEndAction).toHaveBeenCalledWith(3);
});

const ended = { ...base, period: { start: '2025-11-01', end: '2026-10-31', year_end_month: 10 } };
const posted = { ...ended, books: { posted: { id: 'p1', entry_date: '2026-10-31', companies_income_tax: '2988000.00', development_levy: '408000.00', wht_used: '0.00',
  payable: '3396000.00', transaction_id: 9, posted_at: '2026-11-27T10:00:00Z' }, payments: [], outstanding: '3396000.00', reversed: [] } };

test('the owner posts a finished year\'s tax to the books; nothing is offered before the year ends', async () => {
  (incomeTaxAction as jest.Mock).mockResolvedValue({ success: true, data: ended });
  (postTaxAction as jest.Mock).mockResolvedValue({ success: true, data: posted });
  render(<IncomeTaxPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Post ₦3,396,000.00 to the books' }));
  expect(await screen.findByText(/Still to pay:/)).toHaveTextContent('₦3,396,000.00');
  expect(postTaxAction).toHaveBeenCalledWith(base.year, '3a571056-45cf-4239-96bb-331e35c39b65');
});

test('before the year ends the owner is told when it can be posted', async () => {
  render(<IncomeTaxPage />);
  expect(await screen.findByText(/Once the year ends on/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /to the books/ })).not.toBeInTheDocument();
});

test('payments are recorded against the posted tax, and the owner can reverse one with a reason', async () => {
  const paid = { ...posted, books: { ...posted.books, outstanding: '2396000.00',
    payments: [{ id: 't1', amount: '1000000.00', entry_date: '2026-11-27', paid_from: 'The till', reference: null, reversed: false, reversal_reason: null }] } };
  (incomeTaxAction as jest.Mock).mockResolvedValue({ success: true, data: posted });
  (payTaxAction as jest.Mock).mockResolvedValue({ success: true, data: paid });
  (reverseTaxAction as jest.Mock).mockResolvedValue({ success: true, data: posted });
  render(<IncomeTaxPage />);
  fireEvent.change(await screen.findByLabelText('Amount paid (₦)'), { target: { value: '1000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByText(/Still to pay:/)).toHaveTextContent('₦2,396,000.00');
  expect(payTaxAction).toHaveBeenCalledWith(base.year, expect.any(String), expect.objectContaining({ amount: '1000000', method: 'Cash', bank_account_id: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
  fireEvent.change(screen.getByLabelText('Why it is being reversed'), { target: { value: 'Paid twice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reverse payment' }));
  await waitFor(() => expect(reverseTaxAction).toHaveBeenCalledWith(base.year, expect.any(String), 'Paid twice', 't1'));
});
