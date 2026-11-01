import type { ApprovalPolicy, StockAdjustment } from '../../src/lib/corrections';

// Browser test double for src/app/inventory/approval-actions.ts.
const base = { unit_cost: '50000.00', status: 'pending' as const, requested_at: '2026-10-30T09:00:00Z', decided_by: null, decided_at: null, decision_note: null, entry_date: '2026-10-30' };
let pending: StockAdjustment[] = [
  { ...base, id: 'r1', item_id: 'i1', item_name: 'Rice', delta: -2, reason: 'Water damage', value: '100000.00', requested_by: 'editor', mine: false },
  { ...base, id: 'r2', item_id: 'i2', item_name: 'Beans', delta: 3, reason: 'Found in back store', value: '3601.50', requested_by: 'owner', mine: true },
];
let policy: ApprovalPolicy = { stock_threshold: null, separation_of_duties: true };
const decisions: { id: string; approve: boolean; note: string }[] = [];

export async function getStockApprovalsAction() { return { success: true as const, data: { pending: [...pending], policy } }; }

export async function decideStockAdjustmentAction(id: string, approve: boolean, note: string) {
  decisions.push({ id, approve, note });
  (window as unknown as { decisions: typeof decisions }).decisions = decisions;
  pending = pending.filter(p => p.id !== id);
  return { success: true as const, data: { adjustment: { id } } };
}

export async function saveApprovalPolicyAction(next: ApprovalPolicy) {
  policy = { stock_threshold: next.stock_threshold === null ? null : Number(next.stock_threshold).toFixed(2), separation_of_duties: next.separation_of_duties };
  return { success: true as const, data: policy };
}
