import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconciliationPage from '@/app/analytics/reconciliation/page';
import { explainLineAction, importStatementAction, matchLineAction, previewStatementAction, reconciliationAction, recordLineAction } from '@/app/analytics/reconciliation/actions';
import { complete, money, type Reconciliation } from '@/lib/bank-reconciliation';

jest.mock('@/app/analytics/reconciliation/actions', () => ({ reconciliationAction: jest.fn(), previewStatementAction: jest.fn(), importStatementAction: jest.fn(),
  matchLineAction: jest.fn(), recordLineAction: jest.fn(), explainLineAction: jest.fn(), undoLineAction: jest.fn() }));

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

const line = (id: string, description: string, amount: string, extra = {}) => ({ id, date: '2026-11-18', description, amount, balance: null, status: 'unmatched' as const,
  note: null, matched_to: null, suggestions: [], ...extra });
const open: Reconciliation = { accounts: [{ id: 'gtb', name: 'GTBank current' }], account: 'gtb', month: '2026-11-01', statements: [],
  lines: [line('l1', 'TRANSFER FROM BISI ADE', '1500.00', { suggestions: [{ kind: 'transfer', transfer_id: 't1', description: 'Transfer waiting', date: '2026-11-17', amount: '1500.00' }] }),
    line('l2', 'SMS ALERT CHARGES', '-4.00'), line('l3', 'CHEQUE DEPOSIT RETURNED', '999.00')],
  unpresented: [{ transaction_id: 9, number: 'CP-0004', description: 'Rent', date: '2026-11-30', amount: '-80000.00' }],
  books_balance: '320000.00', statement_balance: '401496.00', summary: { lines: 3, unmatched: 3, unpresented: 1, reconciled: false } };

beforeEach(() => { jest.clearAllMocks(); (reconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: open }); });

test('amounts read with their direction and a layout needs its columns', () => {
  expect(money('-4.00')).toBe('−₦4.00');
  expect(money('1500')).toBe('₦1,500.00');
  expect(complete({ header_row: 3, date: 0, description: 2, money_in: 4 })).toBe(false);
  expect(complete({ header_row: 3, date: 0, description: 2, money_in: 4, money_out: 3, date_order: 'DMY' })).toBe(true);
  expect(complete({ header_row: 0, date: 0, description: 1, amount: 2, date_order: 'DMY' })).toBe(true);
});

test('each line can be matched, confirmed as a transfer, recorded as a charge, or explained', async () => {
  (matchLineAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'l1' } });
  (recordLineAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'l2' } });
  (explainLineAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'l3' } });
  render(<ReconciliationPage />);
  expect(await screen.findByText(/3 statement lines to match, and 1 entry in your books not on the statement/)).toBeInTheDocument();
  expect(screen.getByText(/CP-0004 · Rent/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm transfer of 2026-11-17 and match' }));
  await waitFor(() => expect(matchLineAction).toHaveBeenCalledWith('l1', { transfer_id: 't1' }));
  expect(await screen.findByText('Transfer confirmed and matched.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Record as bank charge' }));
  await waitFor(() => expect(recordLineAction).toHaveBeenCalledWith('l2', expect.any(String), 'expense'));
  expect(screen.getAllByRole('button', { name: 'Record as other income' })).toHaveLength(2);  // money in
  await userEvent.click(screen.getAllByRole('button', { name: 'Explain' })[2]);
  const why = screen.getByLabelText('Why CHEQUE DEPOSIT RETURNED needs no entry');
  await userEvent.type(why, 'Cheque bounced');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(explainLineAction).toHaveBeenCalledWith('l3', 'Cheque bounced'));
});

test('a statement is imported after checking the guessed columns', async () => {
  (previewStatementAction as jest.Mock).mockResolvedValue({ success: true, data: { remembered: false,
    rows: [['Account Name', 'Ada'], ['Trans. Date', 'Value Date', 'Narration', 'Debit', 'Credit', 'Balance'], ['18/11/2026', '18/11/2026', 'SMS', '4.00', '', '100']],
    layout: { header_row: 1, date: 0, description: 2, money_out: 3, money_in: 4, balance: 5, date_order: 'DMY' } } });
  (importStatementAction as jest.Mock).mockResolvedValue({ success: true, data: { statement_id: 's1', lines: 5, already_imported: 2, before_books: 0 } });
  render(<ReconciliationPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Import a statement' }));
  const csv = new File(['Account Name,Ada\nTrans. Date,Value Date,Narration,Debit,Credit,Balance\n'], 'nov.csv', { type: 'text/csv' });
  Object.defineProperty(csv, 'text', { value: () => Promise.resolve('statement text') });
  await userEvent.upload(screen.getByLabelText('Statement file'), csv);
  expect(await screen.findByText('CACU has guessed the columns. Check them below.')).toBeInTheDocument();
  expect(screen.getByLabelText('Money out (debit) column')).toHaveValue('3');
  await userEvent.click(screen.getByRole('button', { name: 'Import nov.csv' }));
  await waitFor(() => expect(importStatementAction).toHaveBeenCalledWith(expect.any(String), 'gtb', 'nov.csv', 'statement text',
    { header_row: 1, date: 0, description: 2, money_out: 3, money_in: 4, balance: 5, date_order: 'DMY' }));
  expect(await screen.findByText('5 lines imported. 2 already imported were skipped.')).toBeInTheDocument();
});

test('a business with no bank account is told to add one', async () => {
  (reconciliationAction as jest.Mock).mockResolvedValue({ success: true, data: { accounts: [], account: null } });
  render(<ReconciliationPage />);
  expect(await screen.findByText(/Add a bank account to your chart first/)).toBeInTheDocument();
});
