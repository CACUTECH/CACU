'use server';
// Bank reconciliation (E14 R3, FR-134). The accounting API checks the bank account, the amounts and who may act.
import { accountingRequest } from '@/lib/accounting-client';
import type { Imported, Layout, Preview, Reconciliation } from '@/lib/bank-reconciliation';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const failed = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : 'That did not work. Try again.' });
async function run<T>(work: () => Promise<T>): Promise<Result<T>> { try { return { success: true, data: await work() }; } catch (error) { return failed(error); } }

export async function reconciliationAction(accountId: string | null, month: string) {
  const query = new URLSearchParams({ month, ...(accountId ? { account_id: accountId } : {}) });
  return run(() => accountingRequest<Reconciliation>(`bank/reconciliation?${query}`));
}
export async function previewStatementAction(accountId: string, csv: string) {
  return run(() => accountingRequest<Preview>('bank/statements/preview', { method: 'POST', body: { account_id: accountId, csv } }));
}
export async function importStatementAction(requestKey: string, accountId: string, fileName: string, csv: string, layout: Layout) {
  return run(() => accountingRequest<Imported>('bank/statements', { method: 'POST', body: { request_key: requestKey, account_id: accountId, file_name: fileName, csv, layout } }));
}
export async function matchLineAction(lineId: string, target: { transaction_id?: number; transfer_id?: string }) {
  return run(() => accountingRequest<{ id: string }>('bank/matches', { method: 'POST', body: { line_id: lineId, ...target } }));
}
export async function recordLineAction(lineId: string, requestKey: string, kind: 'expense' | 'income') {
  return run(() => accountingRequest<{ id: string }>(`bank/lines/${encodeURIComponent(lineId)}/record`, { method: 'POST', body: { request_key: requestKey, kind } }));
}
export async function explainLineAction(lineId: string, note: string) {
  return run(() => accountingRequest<{ id: string }>(`bank/lines/${encodeURIComponent(lineId)}/explain`, { method: 'POST', body: { note } }));
}
export async function undoLineAction(lineId: string) {
  return run(() => accountingRequest<{ id: string }>(`bank/lines/${encodeURIComponent(lineId)}/undo`, { method: 'POST' }));
}
