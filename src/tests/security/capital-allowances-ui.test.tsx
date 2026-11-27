import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CapitalAllowances } from '@/components/fixed-assets/capital-allowances';
import { capitalAllowancesAction, saveAssetTaxAction } from '@/app/accounting/fixed-assets/actions';
import type { CapitalAllowances as Allowances } from '@/lib/fixed-assets';

jest.mock('@/app/accounting/fixed-assets/actions', () => ({ capitalAllowancesAction: jest.fn(), saveAssetTaxAction: jest.fn() }));

const year = new Date().getFullYear();
const data: Allowances = { year, reviewed: false, note: 'Prepared from your fixed asset register. CACU does not file tax returns.',
  totals: { allowance: '240000.00', balancing_charge: '0.00', balancing_allowance: '0.00' },
  classes: [{ tax_class: 'other_equipment', label: 'Other equipment expenditure', rate_percent: '20.00' }, { tax_class: 'software', label: 'Software expenditure', rate_percent: '25.00' }],
  assets: [{ asset_id: '7d3c9a57-1b0e-4c64-9a52-5e1f4f2f0a11', name: 'Shop laptop', category: 'computers', tax_class: 'other_equipment', class_label: 'Other equipment expenditure',
    rate_percent: '20.00', qualifies: true, cost: '1200000.00', claimed_before: '0.00', note: null, set: false, opening: '1200000.00', allowance: '240000.00',
    proceeds: null, balancing: '0.00', closing: '960000.00' }] };

beforeEach(() => { jest.clearAllMocks(); (capitalAllowancesAction as jest.Mock).mockResolvedValue({ success: true, data }); });

test('the year’s allowance per asset, marked for review by a tax professional', async () => {
  render(<CapitalAllowances manager={false} firstYear={year} />);
  expect(await screen.findByText('Shop laptop')).toBeInTheDocument();
  expect(capitalAllowancesAction).toHaveBeenCalledWith(year);
  expect(screen.getByRole('note')).toHaveTextContent('still to be confirmed by a tax professional');
  expect(screen.getByText('20% a year · default')).toBeInTheDocument();
  expect(screen.getAllByText('₦240,000.00')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Tax details' })).not.toBeInTheDocument();
});

test('an owner changes an asset’s class and says it does not qualify', async () => {
  (saveAssetTaxAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<CapitalAllowances manager firstYear={year} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tax details' }));
  fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'software' } });
  fireEvent.click(screen.getByLabelText(/so it qualifies/));
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'No VAT charged' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(capitalAllowancesAction).toHaveBeenCalledTimes(2));
  expect(saveAssetTaxAction).toHaveBeenCalledWith(data.assets[0].asset_id, { tax_class: 'software', qualifies: false, claimed_before: '0.00', note: 'No VAT charged', business_use: '100', earns_exempt: false });
});

test('an asset also used privately claims only its business share', async () => {
  (capitalAllowancesAction as jest.Mock).mockResolvedValue({ success: true, data: { ...data, assets: [{ ...data.assets[0], business_use_percent: '60.00', allowance: '144000.00', private_use: '96000.00' }] } });
  (saveAssetTaxAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<CapitalAllowances manager firstYear={year} />);
  expect(await screen.findByText('60% business use · ₦96,000.00 private share not claimed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tax details' }));
  expect(screen.getByLabelText('Business use (%)')).toHaveValue('60');
  fireEvent.change(screen.getByLabelText('Business use (%)'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveAssetTaxAction).toHaveBeenCalledWith(data.assets[0].asset_id, expect.objectContaining({ business_use: '50' })));
});

test('an asset also used for non-taxable income claims only the taxable share once that income is 10% or more', async () => {
  (capitalAllowancesAction as jest.Mock).mockResolvedValue({ success: true, data: { ...data,
    non_taxable: { income: '250000.00', total_income: '1000000.00', share_percent: '25.00', applies: true, threshold_percent: '10.00' },
    assets: [{ ...data.assets[0], earns_exempt: true, allowance: '180000.00', exempt_use: '60000.00' }] } });
  (saveAssetTaxAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<CapitalAllowances manager firstYear={year} />);
  expect(await screen.findByText(/Income that is not taxable is 25% of this year/)).toHaveTextContent('claim only the taxable share');
  expect(screen.getByText('₦60,000.00 not claimed: used for income that is not taxable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tax details' }));
  const box = screen.getByLabelText(/Also used to earn income that is not taxable/);
  expect(box).toBeChecked();
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveAssetTaxAction).toHaveBeenCalledWith(data.assets[0].asset_id, expect.objectContaining({ earns_exempt: false })));
});
