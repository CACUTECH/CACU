import type { GeneralLedger, TrialBalance } from '../../src/lib/ledger-reports';

// Browser test double for src/app/accounting/trial-balance/actions.ts and the account list in journal-entries/actions.ts.
const labels = { tier: 'Management statements, not reviewed', basis: 'Accrual', currency: 'NGN', generated_at: '2026-10-30T12:00:00+01:00' };
const calls: unknown[][] = [];
const record = (...args: unknown[]) => { calls.push(args); (window as unknown as { ledgerCalls: unknown[][] }).ledgerCalls = calls; };

export async function getPostingAccountsAction() { return [{ id: 'cash', name: 'Cash on hand' }, { id: 'ar', name: 'Trade receivables' }]; }

export async function getTrialBalanceAction(asOf: string): Promise<{ success: true; data: TrialBalance }> {
  record('tb', asOf);
  return { success: true, data: { ...labels, as_of: asOf, total_debit: '65000.00', total_credit: '65000.00', difference: '0.00', controls_checked: true,
    exceptions: [{ check: 'receivables', message: 'Customer balances on open invoices (60000.00) differ from the ledger (65000.00)', difference: '5000.00' }],
    lines: [{ account_id: 'cash', code: '1000', name: 'Cash on hand', type: 'BANK', debit: '0.00', credit: '0.00' },
      { account_id: 'ar', code: '1100', name: 'Trade receivables', type: 'RECEIVABLE', debit: '65000.00', credit: '0.00' },
      { account_id: 'eq', code: '3000', name: "Owner's capital", type: 'EQUITY', debit: '0.00', credit: '65000.00' }] } };
}

export async function getGeneralLedgerAction(accountId: string, start: string, end: string, page = 0): Promise<{ success: true; data: GeneralLedger }> {
  record('gl', accountId, start, end, page);
  const entries = page === 0
    ? [{ date: '2026-10-30', number: 'JN01', description: 'Opening balances', counter_account: '3900 Opening balance equity', debit: '25000.00', credit: '0.00', balance: '25000.00' },
       { date: '2026-10-30', number: 'CP01', description: 'Diesel for the generator', counter_account: '6200 Utilities', debit: '0.00', credit: '1000.00', balance: '24000.00' }]
    : [{ date: '2026-10-30', number: 'CP02', description: 'Rent', counter_account: '6100 Rent', debit: '0.00', credit: '2000.00', balance: '22000.00' }];
  return { success: true, data: { ...labels, account: { id: accountId, code: '1000', name: 'Cash on hand' }, start_date: start, end_date: end, opening_balance: '0.00',
    total_debit: '25000.00', total_credit: '3000.00', closing_balance: '22000.00', entries, page, page_size: 2, total_entries: 3 } };
}
