import type { AccountChange, ChartOfAccounts } from '../../src/services/chart-service';

// Browser test double for src/app/accounting/chart-of-accounts/actions.ts.
const accounts: ChartOfAccounts['accounts'] = [
  { id: 'a1', code: '1000', name: 'Cash on hand', account_type: 'asset', purpose: 'cash', flow_section: 'cash', is_active: true, system: true },
  { id: 'a2', code: '1100', name: 'Trade receivables', account_type: 'asset', purpose: 'receivables', flow_section: 'operating', is_active: true, system: true },
  { id: 'a3', code: '2000', name: 'Trade payables', account_type: 'liability', purpose: 'payables', flow_section: 'operating', is_active: true, system: true },
  { id: 'a4', code: '4100', name: 'Service income', account_type: 'revenue', purpose: 'revenue', flow_section: 'operating', is_active: true, system: true },
  { id: 'a5', code: '6100', name: 'Rent', account_type: 'expense', purpose: null, flow_section: 'operating', is_active: true, system: false },
];
let adopted = false;
let failNextAdopt = true;
export const adoptionKeys: string[] = [];
const changes: AccountChange[] = [];

export async function getChartOfAccountsAction() {
  if (!adopted) return { success: true as const, data: { template: null, books_active: false, accounts: [] } };
  return { success: true as const, data: { template: { version: 'NG-2026.1', status: 'pending_review' as const, reviewed_by: null, reviewed_at: null,
    adopted_at: '2026-10-30T09:00:00Z' }, books_active: false, accounts: accounts.map(a => ({ ...a })) } };
}

export async function adoptDefaultChartAction(requestKey: string) {
  adoptionKeys.push(requestKey);
  (window as unknown as { adoptionKeys: string[] }).adoptionKeys = adoptionKeys;
  if (failNextAdopt) { failNextAdopt = false; return { success: false as const, error: 'The accounts were not confirmed. Retry to check whether they were added.' }; }
  adopted = true;
  return { success: true as const, data: { version: 'NG-2026.1', mode: 'SERVICE', accounts: 24, replayed: false } };
}

export async function changeAccountAction(change: AccountChange, booksActive: boolean) {
  changes.push(change); (window as unknown as { accountChanges: unknown[] }).accountChanges = changes.map(c => ({ ...c, booksActive }));
  const name = change.name?.trim();
  if (name && accounts.some(a => a.id !== change.account_id && a.name.toLowerCase() === name.toLowerCase()))
    return { success: false as const, error: 'Another account already has that name.' };
  const account = accounts.find(a => a.id === change.account_id);
  if (change.operation === 'add') accounts.push({ id: 'new', code: '6910', name: name!, account_type: 'expense', purpose: 'other', flow_section: 'operating', is_active: true, system: false, added: true });
  else if (account && change.operation === 'rename') account.name = name!;
  else if (account) account.is_active = change.operation === 'restore';
  return { success: true as const, data: accounts[accounts.length - 1] };
}
