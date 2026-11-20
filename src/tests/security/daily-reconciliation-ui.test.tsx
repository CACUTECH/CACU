import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DailyReconciliationPage from '@/app/reconciliation/daily/page';
import { confirmTransferAction, getDailyReconciliationAction, transferNotReceivedAction } from '@/app/reconciliation/daily/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { waitingFor } from '@/lib/transfers';
import { decideRefundAction, getRefundLimitAction, getStockControlAction, reviewShortfallAction, saveOversellAction, saveRefundLimitAction } from '@/app/reconciliation/daily/actions';
import { useBusiness } from '@/components/business-provider';

jest.mock('@/app/reconciliation/daily/actions', () => ({ getDailyReconciliationAction: jest.fn(), confirmTransferAction: jest.fn(), transferNotReceivedAction: jest.fn(),
  getStockControlAction: jest.fn(), saveOversellAction: jest.fn(), reviewShortfallAction: jest.fn(),
  decideRefundAction: jest.fn(), getRefundLimitAction: jest.fn(), saveRefundLimitAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
jest.mock('@/app/accounting/collection-actions', () => ({ getCollectionAccountsAction: jest.fn() }));
jest.mock('lucide-react', () => ({ X: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

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
  (getRefundLimitAction as jest.Mock).mockResolvedValue({ success: true, data: null });
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

const waitingRefund = { id: 'rf-1', sale_id: 's-1', sale_number: 'JE-0007', amount: '1500.00', method: 'transfer', items: '1 x Beans', reason: 'Damaged tin',
  status: 'pending', requested_by_name: 'Till 1', requested_at: '2026-11-07T10:00:00Z', decided_on: null, decision_note: null, bank_account_id: null, mine: false };

test('an approver pays a waiting transfer refund from a bank, and a rejection needs a reason', async () => {
  (getDailyReconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: { ...report, refunds: { cash: { refunds: 2, total: '3000.00' } }, refunds_pending: [waitingRefund] } });
  (decideRefundAction as jest.Mock).mockResolvedValue({ success: true, data: {} });
  render(<DailyReconciliationPage />);
  expect(await screen.findByText('₦3,000.00 by cash (2) paid back.')).toBeInTheDocument();
  expect(screen.getByText(/Till 1: Damaged tin/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await userEvent.click(screen.getByRole('button', { name: 'Approve and pay' }));  // the only bank account is chosen for them
  await waitFor(() => expect(decideRefundAction).toHaveBeenCalledWith('rf-1', true, '', 'gtb'));
  expect(await screen.findByText('Refund of ₦1,500.00 paid by transfer.')).toBeInTheDocument();
});

test('the requester can only withdraw their own refund, and the owner sets the refund limit', async () => {
  (getDailyReconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: { ...report, refunds_pending: [{ ...waitingRefund, mine: true }] } });
  (saveRefundLimitAction as jest.Mock).mockResolvedValue({ success: true, data: { refund_threshold: '5000.00' } });
  render(<DailyReconciliationPage />);
  expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText('Refund limit (₦)'), '5000');
  await userEvent.click(screen.getByRole('button', { name: 'Save limit' }));
  expect(saveRefundLimitAction).toHaveBeenCalledWith('5000');
  expect(await screen.findByText('Refunds above ₦5,000.00 now need a second person to approve.')).toBeInTheDocument();
});

test('shift differences and shifts left open past midnight are shown to the owner', async () => {
  const base = { opened_at: '2026-11-07T07:05:00Z', opened_on: '2026-11-07', overdue: false, mine: false, opening_float: '5000.00', sales: 3,
    cash_sales: '4000.00', cash_refunds: '0.00', pay_ins: '0.00', pay_outs: '0.00', cash_handed_back: '0.00', expected_cash: '9000.00', closed_on: '2026-11-07' };
  (getDailyReconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: { ...report, shifts: {
    closed: [{ ...base, id: 'a', status: 'closed', opened_by_name: 'Till 1', counted_cash: '8700.00', variance: '-300.00', close_note: 'Gave too much change' },
             { ...base, id: 'b', status: 'closed', opened_by_name: 'Till 2', counted_cash: '9000.00', variance: '0.00', close_note: null }],
    open: [{ ...base, id: 'c', status: 'open', opened_by_name: 'Till 3', opened_on: '2026-11-06', overdue: true, counted_cash: null, variance: null, close_note: null, closed_on: null }],
    variance_total: '-300.00' } } });
  render(<DailyReconciliationPage />);
  expect(await screen.findByText('2 closed. Differences in all: ₦300.00 short.')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Shift differences' })).toHaveTextContent('Till 1: ₦300.00 short (Gave too much change)');
  expect(screen.getByRole('list', { name: 'Shifts still open' })).toHaveTextContent('Till 3: open since 2026-11-06');
  expect(screen.getByText('Open past midnight')).toBeInTheDocument();
});
