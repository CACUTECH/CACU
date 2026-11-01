import type { ExpenseInput, PostedEntry, ReversalInput } from '../../src/lib/corrections';

// Browser test double for src/app/accounting/expenses/actions.ts.
const expenses: PostedEntry[] = [];
const keys: string[] = [];
let failNextRecord = true;
const expose = () => { (window as unknown as { expenseKeys: string[] }).expenseKeys = keys; };

export async function getExpensesAction() {
  return { success: true as const, data: { native: true,
    accounts: [{ id: 'e1', code: '6100', name: 'Rent' }, { id: 'e2', code: '6200', name: 'Utilities and power (including diesel)' }],
    banks: [{ id: 'b1', name: 'Bank account' }], expenses: [...expenses] } };
}

export async function recordExpenseAction(input: ExpenseInput) {
  keys.push(input.request_key); expose();
  if (failNextRecord) { failNextRecord = false; return { success: false as const, error: 'Accounting request failed (503)', uncertain: true }; }
  expenses.unshift({ id: input.request_key, number: `JN0${expenses.length + 1}`, date: input.entry_date, description: input.description, amount: Number(input.amount).toFixed(2), reversed: false });
  return { success: true as const, data: { id: input.request_key } };
}

export async function reverseExpenseAction(id: string, input: ReversalInput) {
  const entry = expenses.find(e => e.id === id);
  if (!entry || !input.reason) return { success: false as const, error: 'Only posted manual journals and expenses can be reversed', uncertain: false };
  entry.reversed = true;
  return { success: true as const, data: { id: input.request_key } };
}
