import type { ChartOfAccounts } from '../../src/services/chart-service';

// Browser test double for src/app/accounting/chart-of-accounts/actions.ts.
const accounts: ChartOfAccounts['accounts'] = [
  { id: 'a1', code: '1000', name: 'Cash on hand', account_type: 'asset', purpose: 'cash', flow_section: 'cash', is_active: true },
  { id: 'a2', code: '1100', name: 'Trade receivables', account_type: 'asset', purpose: 'receivables', flow_section: 'operating', is_active: true },
  { id: 'a3', code: '2000', name: 'Trade payables', account_type: 'liability', purpose: 'payables', flow_section: 'operating', is_active: true },
  { id: 'a4', code: '4100', name: 'Service income', account_type: 'revenue', purpose: 'revenue', flow_section: 'operating', is_active: true },
  { id: 'a5', code: '6100', name: 'Rent', account_type: 'expense', purpose: null, flow_section: 'operating', is_active: true },
];
let adopted = false;
let failNextAdopt = true;
export const adoptionKeys: string[] = [];

export async function getChartOfAccountsAction() {
  if (!adopted) return { success: true as const, data: { template: null, books_active: false, accounts: [] } };
  return { success: true as const, data: { template: { version: 'NG-2026.1', status: 'pending_review' as const, reviewed_by: null, reviewed_at: null,
    adopted_at: '2026-10-30T09:00:00Z' }, books_active: false, accounts } };
}

export async function adoptDefaultChartAction(requestKey: string) {
  adoptionKeys.push(requestKey);
  (window as unknown as { adoptionKeys: string[] }).adoptionKeys = adoptionKeys;
  if (failNextAdopt) { failNextAdopt = false; return { success: false as const, error: 'The accounts were not confirmed. Retry to check whether they were added.' }; }
  adopted = true;
  return { success: true as const, data: { version: 'NG-2026.1', mode: 'SERVICE', accounts: 24, replayed: false } };
}
