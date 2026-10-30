'use server';
import { revalidatePath } from 'next/cache';
import { AccountingRequestError, accountingRequest } from '@/lib/accounting-client';
import type { ActionResult, ApprovalPolicy, StockAdjustment } from '@/lib/corrections';

function failed(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'The change was not confirmed.',
    uncertain: !(error instanceof AccountingRequestError && error.status < 500) };
}

export async function getStockApprovalsAction(): Promise<ActionResult<{ pending: StockAdjustment[]; policy: ApprovalPolicy }>> {
  try {
    const [pending, policy] = await Promise.all([accountingRequest<StockAdjustment[]>('stock/adjustments?status=pending'), accountingRequest<ApprovalPolicy>('approval-policy')]);
    return { success: true, data: { pending, policy } };
  } catch (error) { return failed(error); }
}

export async function decideStockAdjustmentAction(id: string, approve: boolean, note: string) {
  try {
    const data = await accountingRequest<{ adjustment: StockAdjustment }>(`stock/adjustments/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note } });
    revalidatePath('/inventory');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}

export async function saveApprovalPolicyAction(policy: ApprovalPolicy) {
  try { return { success: true as const, data: await accountingRequest<ApprovalPolicy>('approval-policy', { method: 'POST', body: policy }) }; }
  catch (error) { return failed(error); }
}
