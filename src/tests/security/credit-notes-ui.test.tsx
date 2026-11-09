import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditNotesPage from '@/app/invoices/credit-notes/page';
import { CreditNoteDialog } from '@/components/credit-note-dialog';
import { creditNotesAction, creditableAction, decideCreditNoteAction, requestCreditNoteAction } from '@/app/invoices/credit-note-actions';
import { lineCredit, type Creditable, type CreditNote, type CreditableLine } from '@/lib/credit-notes';

jest.mock('@/app/invoices/credit-note-actions', () => ({ creditableAction: jest.fn(), requestCreditNoteAction: jest.fn(),
  creditNotesAction: jest.fn(), decideCreditNoteAction: jest.fn() }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.setTimeout(20000);
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'key-1' });

const rice: CreditableLine = { line_id: 'l1', item_id: 'rice', name: 'Rice', quantity: 3, line_total: '195000.00', creditable_units: 3,
  creditable_amount: '100000.00', restockable: true };
const info: Creditable = { invoice_id: 'i7', invoice_number: 'INV-7', customer_id: 'ada', customer_name: 'Ada', total: '195000.00', credited_total: '0.00',
  outstanding: '50000.00', lines: [rice], refund_threshold: null, can_approve: true };
const note = (over: Partial<CreditNote>): CreditNote => ({ id: 'c1', number: 'CN-0001', invoice_id: 'i7', invoice_number: 'INV-7', customer_id: 'ada',
  customer_name: 'Ada', amount: '65000.00', items: '1 x Rice', reason: 'Spoilt bag', status: 'posted', requested_by_name: 'Bola',
  requested_at: '2026-11-09T09:00:00Z', decided_on: '2026-11-09', decision_note: null, against_invoice: '50000.00', to_advance: '15000.00',
  posting: { credit_note: 'CN-1', advance: 'JN-2', stock_cost_restored: '50000.00' }, mine: false, ...over });

beforeEach(() => { jest.clearAllMocks(); (creditableAction as jest.Mock).mockResolvedValue({ success: true, data: info }); });

test('units take their share of what is left on the line, the last ones all of it; an amount off is capped', () => {
  expect(lineCredit(rice, '1', '')).toEqual({ value: 33333.33, error: null });
  expect(lineCredit(rice, '3', '')).toEqual({ value: 100000, error: null });
  expect(lineCredit(rice, '4', '').error).toBe('Only 3 x Rice can still be credited.');
  expect(lineCredit(rice, '1', '500').error).toMatch('not both');
  expect(lineCredit(rice, '', '100000.01').error).toBe('At most ₦100,000.00 can still be taken off Rice.');
  expect(lineCredit(rice, '', '2500')).toEqual({ value: 2500, error: null });
  expect(lineCredit({ ...rice, creditable_units: 0 }, '1', '').error).toBe('Rice has already been credited in full.');
});

test('an owner credits returned goods; what the invoice no longer owes is kept as advance', async () => {
  (requestCreditNoteAction as jest.Mock).mockResolvedValue({ success: true, data: note({}) });
  const saved = jest.fn();
  render(<CreditNoteDialog invoice={{ id: 'i7', invoice_number: 'INV-7' }} onClose={jest.fn()} onSaved={saved} />);
  await userEvent.type(await screen.findByLabelText('Units given back'), '2');
  expect(screen.getByText('Credit: ₦66,666.67')).toBeInTheDocument();
  expect(screen.getByText(/₦16,666.67 is more than is still owed and will be kept as the customer's advance/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Post credit note' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say why the invoice is credited.');
  await userEvent.type(screen.getByLabelText('Or amount off (NGN)'), '100');
  await userEvent.type(screen.getByLabelText('Reason'), 'Spoilt bags');
  await userEvent.click(screen.getByRole('button', { name: 'Post credit note' }));
  expect(screen.getByRole('alert')).toHaveTextContent('not both');
  expect(requestCreditNoteAction).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText('Or amount off (NGN)'));
  await userEvent.click(screen.getByLabelText(/Back into stock/));  // damaged: not back in stock
  await userEvent.click(screen.getByRole('button', { name: 'Post credit note' }));
  await waitFor(() => expect(requestCreditNoteAction).toHaveBeenCalledWith({ request_key: 'key-1', invoice_id: 'i7', reason: 'Spoilt bags',
    lines: [{ line_id: 'l1', quantity: 2, amount: null, restock: false }] }));
  expect(saved).toHaveBeenCalledWith("CN-0001 posted: ₦65,000.00 off INV-7, of which ₦15,000.00 is kept as the customer's advance.");
});

test('someone without approval asks, and an amount off moves no stock', async () => {
  (creditableAction as jest.Mock).mockResolvedValue({ success: true, data: { ...info, can_approve: false } });
  (requestCreditNoteAction as jest.Mock).mockResolvedValue({ success: true, data: note({ status: 'pending', amount: '2500.00', against_invoice: null, to_advance: null }) });
  const saved = jest.fn();
  render(<CreditNoteDialog invoice={{ id: 'i7', invoice_number: 'INV-7' }} onClose={jest.fn()} onSaved={saved} />);
  await userEvent.type(await screen.findByLabelText('Or amount off (NGN)'), '2500');
  expect(screen.queryByLabelText(/Back into stock/)).not.toBeInTheDocument();
  expect(screen.getByText('An Owner or Admin approves it before it reaches the books.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Reason'), 'Torn bag');
  await userEvent.click(screen.getByRole('button', { name: 'Ask for approval' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('CN-0001 for ₦2,500.00 is waiting for an Owner or Admin to approve it.'));
  expect((requestCreditNoteAction as jest.Mock).mock.calls[0][0].lines).toEqual([{ line_id: 'l1', quantity: 0, amount: '2500', restock: false }]);
});

test('an approver approves, rejects only with a reason, and a requester withdraws their own', async () => {
  const waiting = [note({ id: 'c1', status: 'pending', decided_on: null }), note({ id: 'c2', number: 'CN-0002', status: 'pending', decided_on: null, mine: true })];
  (creditNotesAction as jest.Mock).mockResolvedValue({ success: true, data: { can_approve: true, credit_notes: waiting } });
  (decideCreditNoteAction as jest.Mock).mockResolvedValue({ success: true, data: note({}) });
  render(<CreditNotesPage />);
  expect(await screen.findByText(/CN-0001 · INV-7 · Ada/)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Approve and post' })).toHaveLength(1);  // never your own
  await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Say why the credit note is rejected.');
  expect(decideCreditNoteAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Approve and post' }));
  await waitFor(() => expect(decideCreditNoteAction).toHaveBeenCalledWith('c1', true, ''));
  expect(await screen.findByText('CN-0001 posted: ₦65,000.00 off INV-7.')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
  await waitFor(() => expect(decideCreditNoteAction).toHaveBeenCalledWith('c2', false, ''));
});

test('without approval rights the list shows no decisions', async () => {
  (creditNotesAction as jest.Mock).mockResolvedValue({ success: true, data: { can_approve: false, credit_notes: [note({ status: 'pending', decided_on: null })] } });
  render(<CreditNotesPage />);
  expect(await screen.findByText(/CN-0001 · INV-7/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve and post' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});
