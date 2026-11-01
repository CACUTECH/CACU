'use server';
import { accountingRequest } from '@/lib/accounting-client';
import type { GeneralLedger, TrialBalance } from '@/lib/ledger-reports';

const failed = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : 'Report unavailable' });

export async function getTrialBalanceAction(asOf: string) {
  try { return { success: true as const, data: await accountingRequest<TrialBalance>(`reports/trial-balance?${new URLSearchParams({ as_of: asOf })}`) }; }
  catch (error) { return failed(error); }
}

export async function getGeneralLedgerAction(accountId: string, start: string, end: string, page = 0) {
  try {
    const query = new URLSearchParams({ account_id: accountId, start_date: start, end_date: end, page: String(page) });
    return { success: true as const, data: await accountingRequest<GeneralLedger>(`reports/general-ledger?${query}`) };
  } catch (error) { return failed(error); }
}
