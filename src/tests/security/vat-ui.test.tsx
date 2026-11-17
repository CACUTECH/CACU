import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaxSettingsPage from '@/app/settings/taxes/page';
import VatReturnPage from '@/app/reports/vat-return/page';
import { saveVatAction, saveVatClassesAction, vatAction, vatReturnAction } from '@/app/settings/taxes/actions';
import { percent, validVatNumber, type VatOverview, type VatReturn } from '@/lib/vat';

jest.mock('@/app/settings/taxes/actions', () => ({ vatAction: jest.fn(), saveVatAction: jest.fn(), saveVatClassesAction: jest.fn(), vatReturnAction: jest.fn() }));

const off: VatOverview = { registered: false, vat_number: null, effective_from: null, invoices_include_vat: false, standard_rate: '7.5000',
  items: [{ id: 'i1', name: 'Beans', vat_class: 'standard' }, { id: 'i2', name: 'Rice', vat_class: 'standard' }] };
const on: VatOverview = { ...off, registered: true, vat_number: '12345678-0001', effective_from: '2026-11-01' };
const side = (vat: string, documents: number) => ({ standard_net: '2790.70', zero_rated_net: '1500.00', exempt_net: '0.00', vat, documents });
const november: VatReturn = { month: '2026-11-01', vat_number: '12345678-0001', sales: side('209.30', 3), purchases: { ...side('0.00', 0), standard_net: '0.00', zero_rated_net: '0.00' },
  payable: '209.30', exceptions: [], note: 'Prepared from CACU records for you to check before filing. CACU does not file VAT returns.' };

beforeEach(() => jest.clearAllMocks());

test('rates and VAT numbers read as people write them', () => {
  expect(percent('7.5000')).toBe('7.5%');
  expect(validVatNumber('12345678-0001')).toBe(true);
  expect(validVatNumber('12 3')).toBe(false);
});

test('a registered business turns VAT on with its number and start date, then marks items', async () => {
  (vatAction as jest.Mock).mockResolvedValue({ success: true, data: off });
  (saveVatAction as jest.Mock).mockResolvedValue({ success: true, data: on });
  (saveVatClassesAction as jest.Mock).mockResolvedValue({ success: true, data: { ...on, items: [on.items[0], { ...on.items[1], vat_class: 'zero_rated' }] } });
  render(<TaxSettingsPage />);
  await userEvent.click(await screen.findByLabelText(/registered for VAT and charges it/));
  expect(screen.getByText(/Standard rate: 7.5%/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your VAT number');
  expect(saveVatAction).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('VAT number (TIN)'), '12345678-0001');
  await userEvent.type(screen.getByLabelText('Charging VAT from'), '2026-11-01');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveVatAction).toHaveBeenCalledWith({ registered: true, vat_number: '12345678-0001', effective_from: '2026-11-01', invoices_include_vat: false }));
  expect(await screen.findByText(/VAT is on/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('VAT on Rice'), 'zero_rated');
  await userEvent.click(screen.getByRole('button', { name: 'Save item VAT' }));
  await waitFor(() => expect(saveVatClassesAction).toHaveBeenCalledWith([{ item_id: 'i2', vat_class: 'zero_rated' }]));  // only what changed
  expect(await screen.findByText('1 item updated.')).toBeInTheDocument();
});

test('the VAT return shows sales, purchases, what is payable, and any disagreement with the books', async () => {
  (vatReturnAction as jest.Mock).mockResolvedValue({ success: true, data: november });
  const { unmount } = render(<VatReturnPage />);
  expect(await screen.findByText(/VAT payable for the month: ₦209.30/)).toBeInTheDocument();
  expect(screen.getByText('Sales (3 documents)')).toBeInTheDocument();
  expect(screen.getByText(/CACU does not file VAT returns/)).toBeInTheDocument();
  expect(screen.queryByText(/do not agree with the books/)).not.toBeInTheDocument();
  unmount();
  (vatReturnAction as jest.Mock).mockResolvedValue({ success: true, data: { ...november, exceptions: ['Output VAT in the ledger (100.00) differs from the documents (209.30).'] } });
  render(<VatReturnPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('differs from the documents');
});
