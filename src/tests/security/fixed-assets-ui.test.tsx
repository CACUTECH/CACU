import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FixedAssetsPage from '@/app/accounting/fixed-assets/page';
import { addAssetAction, disposeAssetAction, fixedAssetsAction, postDepreciationAction, previewDepreciationAction, removeAssetAction } from '@/app/accounting/fixed-assets/actions';
import { methodLabel, monthlyStraightLine, type FixedAsset } from '@/lib/fixed-assets';

let mockRole = 'owner';
jest.mock('@/app/accounting/fixed-assets/actions', () => ({ fixedAssetsAction: jest.fn(), addAssetAction: jest.fn(), postDepreciationAction: jest.fn(),
  previewDepreciationAction: jest.fn(), disposeAssetAction: jest.fn(), removeAssetAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: () => ({ business: { id: 'b1', userRole: mockRole } }) }));
let uuid = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `3a571056-45cf-4239-96bb-${String(++uuid).padStart(12, '0')}` });

const laptop: FixedAsset = { id: '7d3c9a57-1b0e-4c64-9a52-5e1f4f2f0a11', name: 'Shop laptop', category: 'computers', category_name: 'Computers and phones',
  reference: 'SN-1', acquired_on: '2026-09-05', how: 'paid', method: 'straight_line', useful_life_months: 12, annual_rate_percent: null, cost: '1200000.00',
  residual: '0.00', accumulated_depreciation: '100000.00', carrying_amount: '1100000.00', depreciate_from: '2026-09', disposed_on: null, disposal_proceeds: null };
const view = (over = {}) => ({ assets: [laptop], runs: [{ month: '2026-09', entry_date: '2026-09-30', total: '100000.00', transaction_id: 7, posted_at: '2026-10-01T09:00:00Z' }],
  due: ['2026-10'], totals: { cost: '1200000.00', accumulated_depreciation: '100000.00', carrying_amount: '1100000.00' },
  pay_from: { cash: true, banks: [{ id: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10', name: 'GTBank' }] }, suppliers: [{ id: '5c1f3a2b-8e4d-4f6a-9b7c-1d2e3f4a5b6c', name: 'Ikeja Furniture' }], ...over });

beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'owner';
  (fixedAssetsAction as jest.Mock).mockResolvedValue({ success: true, data: view() });
  (previewDepreciationAction as jest.Mock).mockResolvedValue({ success: true, data: { month: '2026-10', total: '100000.00', charges: [{ asset_id: laptop.id, name: 'Shop laptop', category_name: 'Computers and phones', amount: '100000.00' }] } });
});

test('labels and the straight-line estimate', () => {
  expect(methodLabel(laptop)).toBe('Straight-line over 1 year');
  expect(methodLabel({ method: 'reducing_balance', useful_life_months: null, annual_rate_percent: '25.00' })).toBe('Reducing balance at 25% a year');
  expect(monthlyStraightLine('1200000', '0', 36)).toBe(33333.33);
});

test('the register shows each asset, and the month waiting for depreciation is posted from the banner', async () => {
  (postDepreciationAction as jest.Mock).mockResolvedValue({ success: true, data: { total: '100000.00' } });
  render(<FixedAssetsPage />);
  expect(await screen.findByText('Shop laptop')).toBeInTheDocument();
  expect(screen.getByText('Depreciation for October 2026 is not posted yet')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/₦100,000.00 across 1 asset\./)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Post October 2026' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Depreciation for October 2026 posted: ₦100,000.00.'));
  expect(postDepreciationAction).toHaveBeenCalledWith('2026-10', expect.stringMatching(/^3a571056/));
  expect(fixedAssetsAction).toHaveBeenCalledTimes(2);
});

test('an asset bought on credit names its supplier and bill', async () => {
  (addAssetAction as jest.Mock).mockResolvedValue({ success: true, data: { ...laptop, name: 'Shelves' } });
  render(<FixedAssetsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add an asset' }));
  fireEvent.change(screen.getByLabelText('Asset'), { target: { value: 'Shelves' } });
  fireEvent.change(screen.getByLabelText('Kind of asset'), { target: { value: 'furniture' } });
  fireEvent.change(screen.getByLabelText('How it was bought'), { target: { value: 'credit' } });
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: '5c1f3a2b-8e4d-4f6a-9b7c-1d2e3f4a5b6c' } });
  fireEvent.change(screen.getByLabelText('Their bill number'), { target: { value: 'IF-77' } });
  fireEvent.change(screen.getByLabelText('Cost before VAT (₦)'), { target: { value: '250000' } });
  fireEvent.change(screen.getByLabelText('VAT on the bill (₦)'), { target: { value: '18750' } });
  fireEvent.change(screen.getByLabelText('Useful life (months)'), { target: { value: '60' } });
  expect(screen.getByText('About ₦4,166.67 a month.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add asset' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Shelves added.'));
  expect(addAssetAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: 'Shelves', category: 'furniture', how: 'credit',
    supplier_id: '5c1f3a2b-8e4d-4f6a-9b7c-1d2e3f4a5b6c', bill_number: 'IF-77', cost: '250000', vat: '18750', useful_life_months: 60 }));
});

test('selling an asset shows the gain before it is recorded', async () => {
  (disposeAssetAction as jest.Mock).mockResolvedValue({ success: true, data: { ...laptop, disposed_on: '2026-10-20', disposal_proceeds: '1150000.00', disposal_result: '50000.00' } });
  render(<FixedAssetsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sell or scrap' }));
  fireEvent.change(screen.getByLabelText('Sold for, before VAT (₦)'), { target: { value: '1150000' } });
  fireEvent.change(screen.getByLabelText('VAT charged (₦)'), { target: { value: '86250' } });
  expect(screen.getByRole('form', { name: 'Dispose of Shop laptop' })).toHaveTextContent('That is a gain of ₦50,000.00.');
  fireEvent.change(screen.getByLabelText('Money went into'), { target: { value: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record disposal' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Shop laptop taken out of the books, with a gain of ₦50,000.00.'));
  expect(disposeAssetAction).toHaveBeenCalledWith(laptop.id, expect.any(String), expect.objectContaining({ proceeds: '1150000', vat: '86250', method: 'Transfer',
    bank_account_id: '0b9b3f0e-2d8a-4f6c-8a43-6f2b1d7a9c10' }));
});

test('viewers see the register but cannot change it', async () => {
  mockRole = 'viewer';
  render(<FixedAssetsPage />);
  expect(await screen.findByText('Shop laptop')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(previewDepreciationAction).not.toHaveBeenCalled();
});

test('the owner removes an asset entered in error, with a reason', async () => {
  (removeAssetAction as jest.Mock).mockResolvedValue({ success: true });
  render(<FixedAssetsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Entered in error' }));
  fireEvent.change(screen.getByLabelText('Why it is being removed'), { target: { value: 'Entered twice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove asset' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Shop laptop removed, and everything it put in the books reversed.'));
  expect(removeAssetAction).toHaveBeenCalledWith(laptop.id, expect.any(String), 'Entered twice');
});

test('an admin can sell or scrap but not remove', async () => {
  mockRole = 'admin';
  render(<FixedAssetsPage />);
  expect(await screen.findByRole('button', { name: 'Sell or scrap' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Entered in error' })).not.toBeInTheDocument();
});
