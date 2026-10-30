import type { OpeningAnswers, OpeningPosition } from '../../src/services/opening-position-service';

// Browser test double for src/app/setup/books/actions.ts. Totals mirror save_opening_position.
const base: OpeningPosition = {
  chart_ready: true, books_active: false, stock_value: '503601.5',
  bank_accounts: [{ id: 'bank-1', name: 'Bank account' }], customers: [{ id: 'cust-1', name: 'Ada Stores' }], suppliers: [],
  position: null,
};
let state: OpeningPosition = base;
let failFirstSave = true;
const calls: { key: string; version: number; answers: OpeningAnswers }[] = [];

export async function getOpeningPositionAction() { return { success: true as const, data: state }; }

export async function saveOpeningPositionAction(key: string, version: number, answers: OpeningAnswers) {
  calls.push({ key, version, answers });
  (window as unknown as { openingCalls: typeof calls }).openingCalls = calls;
  if (failFirstSave) {
    failFirstSave = false;
    return { success: false as const, error: 'The change was not confirmed. Retry to check whether it was saved.', uncertain: true };
  }
  const n = (v: string) => Number(v || 0);
  const banks = answers.banks.reduce((t, b) => t + n(b.amount), 0);
  const customers = answers.customers.reduce((t, c) => t + n(c.amount), 0);
  const owns = n(answers.cash) + banks + n(state.stock_value) + customers;
  const owes = n(answers.loans);
  const equity = owns - owes;
  const money = (v: number) => v.toFixed(2);
  state = { ...state, position: { version: version + 1, status: 'draft', as_of: answers.as_of, answers, approved_at: null, approved_by: null,
    summary: { cash: money(n(answers.cash)), banks: money(banks), stock: state.stock_value, customers: money(customers), owns: money(owns),
      suppliers: '0.00', loans: money(owes), owes: money(owes), owner_equity: money(equity), capital: money(n(answers.capital)),
      retained: money(equity - n(answers.capital)) },
    journal: { entry_date: answers.as_of, lines: [
      { code: '1000', account_id: 'a1000', name: 'Cash on hand', side: 'debit', amount: answers.cash },
      { code: '1100', account_id: 'a1100', name: 'Trade receivables', side: 'debit', amount: answers.customers[0].amount, party_type: 'customers', party_id: 'cust-1' },
      { code: '3200', account_id: 'a3200', name: 'Retained earnings', side: 'credit', amount: money(equity - n(answers.capital)) },
    ] } } };
  return { success: true as const, data: state };
}

export async function approveOpeningPositionAction(version: number) {
  if (!state.position || state.position.version !== version) return { success: false as const, error: 'Someone else changed these answers.', uncertain: false };
  state = { ...state, position: { ...state.position, status: 'approved', approved_at: '2026-10-30T10:00:00Z', approved_by: 'Ada Owner' } };
  return { success: true as const, data: state };
}
