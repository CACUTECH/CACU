import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DailyReconciliationPage from '@/app/reconciliation/daily/page';
import { confirmTransferAction, getDailyReconciliationAction, transferNotReceivedAction } from '@/app/reconciliation/daily/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { waitingFor } from '@/lib/transfers';
import { getStockControlAction, reviewShortfallAction, saveOversellAction } from '@/app/reconciliation/daily/actions';
import { useBusiness } from '@/components/business-provider';

jest.mock('@/app/reconciliation/daily/actions', () => ({ getDailyReconciliationAction: jest.fn(), confirmTransferAction: jest.fn(), transferNotReceivedAction: jest.fn(),
  getStockControlAction: jest.fn(), saveOversellAction: jest.fn(), reviewShortfallAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('lucide-react', () => ({ X: () => null }));

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });
const sale = { id: 'aaaaaaaa-1111-4111-8111-111111111111', kind: 'sale', amount: '65000.00', entry_date: '2026-11-05', age_days: 2,
  invoice_number: null, customer: null, expected_bank_account_id: null, status: 'pending' };
const payment = { ...sale, id: 'bbbbbbbb-2222-4222-8222-222222222222', kind: 'invoice payment', amount: '40000.00', age_days: 0, invoice_number: 'INV-7', customer: 'Ada' };
const report = { date: '2026-11-07', pending: [sale, payment], pending_total: '105000.00',
  by_method: { cash: { sales: 3, total: '12000.00', awaiting: '0.00', reversed: '0.00' }, transfer: { sales: 1, total: '65000.00', awaiting: '65000.00', reversed: '0.00' } } };

beforeEach(() => {
  jest.clearAllMocks();
  (getDailyReconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: report });
  (getCollectionAccountsAction as jest.Mock).mockResolvedValue({ native: true, accounts: [{ id: 'gtb', name: 'GTBank' }] });
  (getStockControlAction as jest.Mock).mockResolvedValue({ success: true, data: { allow_oversell: false, shortfalls: [] } });
  (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'b1', name: 'Ada Provisions', userRole: 'owner' } });
});

test('shows the day by method and every transfer still waiting, oldest flagged', async () => {
  render(<DailyReconciliationPage />);
  expect(await screen.findByText('65000.00 awaiting confirmation'.replace('65000.00', '₦65,000.00'))).toBeInTheDocument();
  expect(screen.getByText(/2 waiting, ₦105,000.00 in all/)).toBeInTheDocument();
  expect(screen.getByText('2 days')).toBeInTheDocument();
  expect(screen.getByText('INV-7, Ada')).toBeInTheDocument();
});

test('confirming asks for the bank and keeps the same request key on retry', async () => {
  (confirmTransferAction as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The change was not confirmed. Refresh before trying again.', uncertain: true })
    .mockResolvedValueOnce({ success: true, data: {} });
  render(<DailyReconciliationPage />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'Confirm' }))[0]);
  const confirm = screen.getByRole('button', { name: 'Confirm received' });
  expect(confirm).toBeEnabled();  // the only bank account is chosen for them
  await userEvent.click(confirm);
  expect(await screen.findByRole('alert')).toHaveTextContent('not confirmed');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('₦65,000.00 confirmed and moved to the bank.'));
  const [first, second] = (confirmTransferAction as jest.Mock).mock.calls;
  expect(first).toEqual([sale.id, expect.any(String), 'gtb']);
  expect(second[1]).toBe(first[1]);
});

test('not received needs a reason and says the sale is reversed', async () => {
  (transferNotReceivedAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<DailyReconciliationPage />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'Not received' }))[0]);
  expect(screen.getByText(/goods return to stock/)).toBeInTheDocument();
  const mark = screen.getByRole('button', { name: 'Mark not received' });
  expect(mark).toBeDisabled();
  await userEvent.type(screen.getByLabelText('What happened'), 'Transfer failed');
  await userEvent.click(mark);
  await waitFor(() => expect(transferNotReceivedAction).toHaveBeenCalledWith(sale.id, expect.any(String), 'Transfer failed'));
  expect(await screen.findByRole('status')).toHaveTextContent('goods returned to stock');
});

test('before the books are on, the page says why it is empty', async () => {
  (getDailyReconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: null });
  render(<DailyReconciliationPage />);
  expect(await screen.findByText(/available once your books are turned on/)).toBeInTheDocument();
});

test('waiting time reads in words', () => {
  expect([0, 1, 4].map(waitingFor)).toEqual(['today', '1 day', '4 days']);
});

test('the owner switches overselling on, and each shortfall is marked reviewed', async () => {
  (getStockControlAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { allow_oversell: false, shortfalls: [] } })
    .mockResolvedValue({ success: true, data: { allow_oversell: true, shortfalls: [{ sale_id: 'cccccccc-3333', item_id: 'beans', item: 'Beans', quantity: 2, created_at: '2026-11-07T10:00:00Z', reviewed: false }] } });
  (saveOversellAction as jest.Mock).mockResolvedValue({ success: true, data: { allow_oversell: true } });
  (reviewShortfallAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<DailyReconciliationPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Allow selling beyond recorded stock' }));
  expect(saveOversellAction).toHaveBeenCalledWith(true);
  expect(await screen.findByText(/2 x Beans more than recorded/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
  expect(reviewShortfallAction).toHaveBeenCalledWith('cccccccc-3333', 'beans');
});

test('only the owner sees the overselling switch', async () => {
  (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'b1', userRole: 'admin' } });
  render(<DailyReconciliationPage />);
  expect(await screen.findByText('The till stops at recorded stock.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /selling beyond/ })).not.toBeInTheDocument();
});
