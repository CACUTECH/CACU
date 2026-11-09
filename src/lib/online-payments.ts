// Online invoice payments through the business's own Paystack account (Doc 10 E23). Shapes the accounting API returns.
export type PaystackSettings = {
  connected: boolean; can_manage: boolean; banks: { id: string; name: string }[];
  mode?: 'test' | 'live'; key_hint?: string; settlement_bank_account_id?: string; connected_at?: string; webhook_url?: string | null;
};
export type OnlinePayment = {
  reference: string; status: 'pending' | 'posted' | 'failed' | 'needs_review'; amount: string; paid: string | null; fee: string | null;
  paid_at: string | null; channel: string | null; review_reason: string | null; settled: boolean; invoice_number: string; customer: string | null; started_at: string;
};
export type Payout = {
  id: string; settled_on: string; gross: string; fee: string; net: string; reported_net: string | null; unmatched: string;
  status: 'posted' | 'needs_review'; note: string | null;
};
export type OnlineOverview = { settings: PaystackSettings; awaiting_payout: string; payments: OnlinePayment[]; payouts: Payout[] };
export type CheckReport = { checked: number; posted: number; payouts: number; payouts_for_review: number };
export type PayLink = { token: string; invoice_number: string; outstanding: string };
export type PaySummary = {
  business: { name: string; address: string | null; phone: string | null }; invoice_number: string; issue_date: string | null; due_date: string | null;
  customer_name: string | null; total: string; outstanding: string; payable: string; needs_email: boolean; minimum: string;
};
export type PayStatus = { status: OnlinePayment['status']; paid: string | null; summary?: PaySummary };

export const naira = (value: string | number | null | undefined) =>
  `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PAYMENT_STATUS: Record<OnlinePayment['status'], string> = {
  pending: 'Waiting for the customer', posted: 'Paid', failed: 'Not completed', needs_review: 'Needs review',
};

/** The amount a customer may pay: above zero, at most what is payable, and at least the minimum unless it clears the invoice. */
export function payAmountError(amount: string, summary: Pick<PaySummary, 'payable' | 'minimum'>): string | null {
  if (!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(amount.trim())) return 'Enter an amount in naira, like 25000.';
  const value = Number(amount), payable = Number(summary.payable);
  if (value <= 0) return 'Enter an amount above zero.';
  if (value > payable) return `At most ${naira(payable)} is still owed.`;
  if (value < Number(summary.minimum) && value !== payable) return `Pay at least ${naira(summary.minimum)}.`;
  return null;
}
