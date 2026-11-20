// Browser test double for src/app/pos/offline-actions.ts: nothing is waiting on the device in these tests.
export async function syncOfflineSaleAction() { return { success: true as const, data: { status: 'posted' as const, sale_id: '' } }; }
export async function syncOfflineExpenseAction() { return { success: true as const, data: { status: 'posted' as const, sale_id: '' } }; }
export async function offlineReviewAction() { return { success: true as const, data: { can_decide: false, sales: [] } }; }
export async function decideOfflineSaleAction() { return { success: false as const, error: 'Not available in this test', uncertain: false }; }
