'use server';
// Batches and expiry dates (E09 R3). The accounting API checks who may change tracking and posts write-offs.
import { accountingRequest } from '@/lib/accounting-client';
import type { Batches } from '@/lib/batches';

type Result<T> = { success: true; data: T } | { success: false; error: string };
async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try { return { success: true, data: await work() }; } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'That did not work. Try again.' }; }
}
export async function batchesAction() { return run(() => accountingRequest<Batches>('batches')); }
export async function batchTrackingAction(itemId: string, track: boolean) {
  return run(() => accountingRequest<Batches>('batches/tracking', { method: 'POST', body: { item_id: itemId, track } }));
}
export async function writeOffBatchAction(batchId: string, requestKey: string, quantity: number, reason: string) {
  return run(() => accountingRequest<{ adjustment: { status: string } }>(`batches/${encodeURIComponent(batchId)}/write-off`, { method: 'POST', body: { request_key: requestKey, quantity, reason } }));
}
