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
  expect(saveAssetTaxAction).toHaveBeenCalledWith(data.assets[0].asset_id, { tax_class: 'software', qualifies: false, claimed_before: '0.00', note: 'No VAT charged' });
});
