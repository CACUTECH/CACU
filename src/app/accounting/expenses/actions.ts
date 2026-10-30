'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { CollectionAccount } from '@/lib/collection-accounts';
import type { ActionResult, ExpenseAccount, ExpenseInput, PostedEntry, ReversalInput } from '@/lib/corrections';

function failed(error: unknown) {
  // A 4xx answer means nothing was recorded; anything else may have been, so the same request key is retried.
  return { success: false as const, error: error instanceof Error ? error.message : 'The expense was not confirmed.',
    uncertain: !(error instanceof AccountingRequestError && error.status < 500) };
}

export async function getExpensesAction(): Promise<ActionResult<{ native: boolean; accounts: ExpenseAccount[]; banks: CollectionAccount[]; expenses: PostedEntry[] }>> {
  try {
    if (!(await usesPythonAccounting())) return { success: true, data: { native: false, accounts: [], banks: [], expenses: [] } };
    const [accounts, banks, expenses] = await Promise.all([
      accountingRequest<ExpenseAccount[]>('expense-accounts'), accountingRequest<CollectionAccount[]>('collection-accounts'), accountingRequest<PostedEntry[]>('expenses')]);
    return { success: true, data: { native: true, accounts, banks, expenses } };
  } catch (error) { return failed(error); }
}

export async function recordExpenseAction(input: ExpenseInput) {
  try {
    const data = await accountingRequest<{ id: string }>('expenses', { method: 'POST', body: input });
    revalidatePath('/accounting/expenses');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}

export async function reverseExpenseAction(id: string, input: ReversalInput) {
  try {
    const data = await accountingRequest<{ id: string }>(`expenses/${encodeURIComponent(id)}/reversal`, { method: 'POST', body: input });
    revalidatePath('/accounting/expenses');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}
