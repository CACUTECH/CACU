/** Shapes returned by the accounting API for expenses, reversals and stock adjustment approvals. */
export type PostedEntry = { id: string; number: string; date: string; description: string; amount: string; reversed: boolean };
export type ExpenseAccount = { id: string; code: string; name: string };
export type ReversalInput = { request_key: string; entry_date: string; reason: string };
export type ExpenseInput = {
  request_key: string; expense_account_id: string; amount: string; entry_date: string;
  method: 'Cash' | 'Transfer'; bank_account_id?: string; description: string;
};
export type StockAdjustment = {
  id: string; item_id: string; item_name?: string; delta: number; reason: string; entry_date: string; unit_cost: string; value: string;
  status: 'pending' | 'posted' | 'rejected'; requested_by: string; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; mine?: boolean;
};
export type ApprovalPolicy = { stock_threshold: string | null; separation_of_duties: boolean };
export type ActionResult<T> = { success: true; data: T } | { success: false; error: string; uncertain: boolean };
