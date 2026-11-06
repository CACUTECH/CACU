// Jobs (Doc 10 services rules): service and material lines, labour, completion (materials leave stock) and billing.
export type JobStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type Job = {
  id: string; number: string | null; title: string; status: JobStatus; customer_id: string | null; customer_name: string | null;
  staff_id: string | null; description: string | null; due_date: string | null; cancel_reason: string | null;
  bill_kind: 'sale' | 'invoice' | null; created_at: string;
};
export type JobLine = { id: string; catalog_item_id: string; quantity: number };
export type JobLabour = { id: string; staff_id: string; minutes: number; note: string };
export type JobMoney = {
  id: string; number: string | null; status: JobStatus; bill_kind: 'sale' | 'invoice' | null; bill_id: string | null;
  revenue: string; materials_cost: string; materials_issued: boolean;
  lines: { item_id: string; name: string; kind: 'service' | 'material'; quantity: number; unit_price: string; total: string }[];
  profit: { labour_cost: string; profit: string; unrated_entries: number } | null;
};
export type CostRates = { available: boolean; rates: Record<string, string> };

export const JOB_STATUS: Record<JobStatus, string> = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const JOB_COLUMNS = 'id, number, title, status, customer_id, customer_name, staff_id, description, due_date, cancel_reason, bill_kind, created_at';

const MESSAGES: Record<string, string> = {
  CUSTOMER_REQUIRED: 'Choose a customer or type their name.',
  ITEM_UNAVAILABLE: 'That item is not an active, priced item in your catalogue.',
  STAFF_UNAVAILABLE: 'That staff member no longer works here.',
  JOB_CLOSED: 'This job is completed or cancelled and can no longer change.',
  JOB_STATE_INVALID: 'This job has already moved on. Refresh to see its latest state.',
  CANCEL_REASON_REQUIRED: 'Say why the job is cancelled.',
  JOB_COMPLETED_BY_API: 'Complete the job with the Complete button.',
  SUBSCRIPTION_READ_ONLY: 'Your workspace is read-only until the subscription is paid.',
};

/** A database refusal in plain words. */
export function jobError(error: { message?: string; code?: string } | null | undefined, fallback = 'The change was not saved. Refresh and try again.') {
  const message = error?.message ?? '';
  const known = Object.keys(MESSAGES).find(code => message.includes(code));
  if (known) return MESSAGES[known];
  if (error?.code === '23505') return 'That item is already on the job. Change its quantity instead.';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) return 'You do not have permission to do this. Ask the business owner.';
  return fallback;
}

/** Whether a till cart is exactly the job's lines, as the server requires. */
export function matchesJob(cart: { id: string; quantity: number }[], lines: { item_id: string; quantity: number }[]) {
  if (cart.length !== lines.length) return false;
  return lines.every(l => cart.some(c => c.id === l.item_id && c.quantity === l.quantity));
}
