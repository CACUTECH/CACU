'use server';
// Customer segments and tags (E06 R3). The accounting API checks who may see and change them.
import { accountingDownload, accountingRequest } from '@/lib/accounting-client';
import type { Members, Overview, Rules } from '@/lib/segments';

type Result<T> = { success: true; data: T } | { success: false; error: string };
async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try { return { success: true, data: await work() }; } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'That did not work. Try again.' }; }
}
export async function segmentsAction() { return run(() => accountingRequest<Overview>('segments')); }
export async function previewSegmentAction(rules: Rules) { return run(() => accountingRequest<Members>('segments/preview', { method: 'POST', body: rules })); }
export async function saveSegmentAction(id: string, name: string, rules: Rules) {
  return run(() => accountingRequest<Members & { id: string }>('segments', { method: 'POST', body: { id, name, rules } }));
}
export async function deleteSegmentAction(id: string) { return run(() => accountingRequest<Overview>(`segments/${encodeURIComponent(id)}/delete`, { method: 'POST' })); }
export async function exportSegmentAction(id: string) { return run(async () => (await accountingDownload(`segments/${encodeURIComponent(id)}/export`)).text()); }
export async function setTagsAction(customerId: string, tags: string[]) {
  return run(() => accountingRequest<{ tags: string[] }>(`customers/${encodeURIComponent(customerId)}/tags`, { method: 'POST', body: { tags } }));
}
