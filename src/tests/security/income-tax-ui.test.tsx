import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncomeTaxPage from '@/app/accounting/income-tax/page';
import { addTaxAdjustmentAction, incomeTaxAction, saveTaxYearAction } from '@/app/accounting/income-tax/actions';
import type { IncomeTaxEstimate } from '@/lib/income-tax';

let mockRole = 'owner';
jest.mock('@/app/accounting/income-tax/actions', () => ({ incomeTaxAction: jest.fn(), saveTaxYearAction: jest.fn(), addTaxAdjustmentAction: jest.fn(), removeTaxAdjustmentAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', userRole: mockRole } }) }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => '3a571056-45cf-4239-96bb-331e35c39b65' });

const base: IncomeTaxEstimate = { year: new Date().getFullYear(), small_company: false, not_small_because: ['turnover is above ₦50,000,000'],
  turnover: '60000000.00', fixed_assets: '1200000.00',
  steps: [{ label: 'Profit before tax, from the books', amount: '10000000.00' }, { label: 'Add: depreciation in the books', amount: '200000.00' },
    { label: 'Adjusted profit', amount: '10200000.00' }, { label: 'Assessable profit', amount: '10200000.00' }, { label: 'Less: capital allowances', amount: '-240000.00' },
    { label: 'Total profits', amount: '9960000.00' }],
  companies_income_tax: '2988000.00', development_levy: '408000.00', total_due: '3396000.00', cit_rate_percent: '30.00', levy_rate_percent: '4.00',
  small_turnover: '50000000.00', small_fixed_assets: '250000000.00', losses_carried_forward: '0.00', allowances_carried_forward: '0.00',
  told: { losses_brought_forward: '0.00', professional_services: false }, adjustments: [], reviewed: false, note: 'CACU does not file tax returns.' };

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
