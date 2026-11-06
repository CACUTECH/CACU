// Transfers awaiting confirmation (BR-010) and the owner's daily reconciliation (Doc 10).
export type PendingTransfer = {
  id: string; kind: 'sale' | 'invoice payment'; amount: string; entry_date: string; age_days: number;
  invoice_number: string | null; customer: string | null; expected_bank_account_id: string | null; status: string;
};
export type MethodTotals = { sales: number; total: string; awaiting: string; reversed: string };
export type DailyReconciliation = { date: string; by_method: Record<string, MethodTotals>; pending: PendingTransfer[]; pending_total: string };

export const METHOD_LABELS: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', card: 'Card' };

/** "today", "1 day", "3 days": how long a transfer has been waiting. */
export function waitingFor(days: number) {
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}

export function naira(amount: string | number) {
  return `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Today's date in the business time zone, as YYYY-MM-DD. */
export function lagosToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now);
}
