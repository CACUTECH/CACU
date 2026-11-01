"use server";
import { accountingRequest, AccountingRequestError } from '@/lib/accounting-client';
import type { CloseInput, CloseMetadata, CloseReport, InventoryOverview } from '@/lib/ifrs';
function failure(error: unknown) { return { success: false as const, error: error instanceof Error ? error.message : 'Request not confirmed', uncertain: !(error instanceof AccountingRequestError && error.status < 500) }; }
export async function loadCloseMetadataAction() {
  try { return { success: true as const, data: await accountingRequest<CloseMetadata>('reporting-close') }; } catch (e) { return failure(e); }
}
export async function submitCloseAction(input: CloseInput) {
  try { return { success: true as const, data: await accountingRequest<CloseReport>('reporting-close', { method: 'POST', body: input }) }; } catch (e) { return failure(e); }
}
export async function loadCloseAction(id: string) {
  try { return { success: true as const, data: await accountingRequest<CloseReport>(`reporting-close/${encodeURIComponent(id)}`) }; } catch (e) { return failure(e); }
}
export async function approveCloseAction(id: string, evidence: string) {
  try { return { success: true as const, data: await accountingRequest<CloseReport>(`reporting-close/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { evidence } }) }; } catch (e) { return failure(e); }
}
export async function loadValuationAction() {
  try {
    const [inventory, metadata] = await Promise.all([accountingRequest<InventoryOverview>('inventory/valuation'), accountingRequest<CloseMetadata>('reporting-close')]);
    return { success: true as const, data: { inventory, accounts: metadata.accounts, suppliers: metadata.suppliers, cash_classifications:metadata.cash_classifications || [] } };
  } catch (e) { return failure(e); }
}
export async function valuationCommandAction(operation: string, input: unknown) {
  const paths = { policy: 'inventory/policy', adopt: 'inventory/adopt', receipts: 'inventory/receipts', nrv: 'inventory/nrv', returns: 'inventory/returns', classification: 'cash-flow-classifications' };
  if (!Object.hasOwn(paths, operation)) return { success: false as const, error: 'Unknown valuation operation', uncertain: false };
  try { const data = await accountingRequest<unknown>(paths[operation as keyof typeof paths], { method: 'POST', body: input }); return { success: true as const, data }; } catch (e) { return failure(e); }
}
