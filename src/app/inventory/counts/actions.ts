'use server';
// Stock counts (E09 R3). The accounting API checks who may count and approve, and posts the differences.
import { accountingRequest } from '@/lib/accounting-client';
import type { StockCount } from '@/lib/stock-counts';

type Result<T> = { success: true; data: T } | { success: false; error: string };
async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try { return { success: true, data: await work() }; } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'That did not work. Try again.' }; }
}
export async function countsAction() { return run(() => accountingRequest<StockCount[]>('stock-counts')); }
export async function countAction(id: string) { return run(() => accountingRequest<StockCount>(`stock-counts/${encodeURIComponent(id)}`)); }
export async function startCountAction(requestKey: string, name: string) {
  return run(() => accountingRequest<StockCount>('stock-counts', { method: 'POST', body: { request_key: requestKey, name } }));
}
export async function saveCountAction(id: string, lines: { item_id: string; counted: number | null }[]) {
  return run(() => accountingRequest<StockCount>(`stock-counts/${encodeURIComponent(id)}/lines`, { method: 'POST', body: { lines } }));
}
export async function submitCountAction(id: string) { return run(() => accountingRequest<StockCount>(`stock-counts/${encodeURIComponent(id)}/submit`, { method: 'POST' })); }
export async function decideCountAction(id: string, approve: boolean, note: string) {
  return run(() => accountingRequest<StockCount>(`stock-counts/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note } }));
}
