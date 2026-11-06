// POS checkout (Doc 10): discounts, change and the receipt, worked in kobo so the till agrees with the server.
export type CheckoutOptions = { discount_cap: string; allow_oversell: boolean; refund_threshold?: string | null; require_shift?: boolean };
export type SaleReceipt = {
  id: string; number: string; date: string; status: string; method: string;
  subtotal: string; discount_total: string; total: string; cash_received: string | null; change: string | null; transfer_amount: string | null;
  refunded_total?: string | null;
  items: { name: string; quantity: number; unit_price: string; discount: string; total: string }[];
};

/** Naira to kobo, exactly (prices have at most two decimals). */
export function kobo(naira: number | string) {
  return Math.round(Number(naira) * 100);
}

/** A line's net amount in kobo: price times quantity less the discount, rounded half up to the kobo as the server does. */
export function lineKobo(price: number | string, quantity: number, discountPercent: string | number = 0) {
  const gross = kobo(price) * quantity;
  const basisPoints = Math.round(Number(discountPercent || 0) * 100);
  const discount = Math.floor((gross * basisPoints + 5000) / 10000);
  return { gross, discount, net: gross - discount };
}

export function formatKobo(value: number) {
  return (value / 100).toFixed(2);
}

export function nairaText(value: number) {
  return `₦${(value / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A valid discount: 0 up to the cap, at most two decimals. */
export function validDiscount(value: string, cap: number) {
  return /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) >= 0 && Number(value) <= cap;
}

/** The text shared on WhatsApp for a receipt. */
export function receiptText(r: SaleReceipt, business: string) {
  const lines = r.items.map(i => `${i.quantity} x ${i.name}: ₦${i.total}`);
  const paid = r.status === 'pending_payment' ? 'Transfer awaiting confirmation' : `Paid by ${r.method}`;
  return [business, `Receipt ${r.number}, ${r.date}`, ...lines, Number(r.discount_total) > 0 ? `Discount: ₦${r.discount_total}` : null,
    `Total: ₦${r.total}`, paid, r.change ? `Change: ₦${r.change}` : null,
    Number(r.refunded_total ?? 0) > 0 ? `Refunded: ₦${r.refunded_total}` : null].filter(Boolean).join('\n');
}

// Refunds (Doc 10, PR-16): what is left on each line, and the amount the server will refund for a quantity.
export type RefundableLine = { line_id: string; item_id: string; name: string; quantity: number; refundable: number; refundable_amount: string; restockable: boolean };
export type Refundable = {
  sale_id: string; number: string; date: string; status: string; method: string; default_method: 'Cash' | 'Transfer';
  total: string; refunded_total: string; lines: RefundableLine[]; refund_threshold: string | null; can_approve: boolean;
};
export type Refund = {
  id: string; sale_id: string; sale_number: string; amount: string; method: 'cash' | 'transfer'; items: string; reason: string;
  status: 'pending' | 'posted' | 'rejected'; requested_by_name: string; requested_at: string; decided_on: string | null;
  decision_note: string | null; bank_account_id: string | null; mine: boolean;
};
export type TillSale = { id: string; number: string; status: string; method: string; total: string; refunded_total: string };
export type ParkedItem = { item_id: string; quantity: number; discount_percent: string };
export type ParkedSale = { id: string; label: string; items: ParkedItem[]; created_at: string };

/** The refund for `quantity` of a line, in kobo: the rest of the line's net amount shared by unit, rounded half up as the server does. */
export function refundKobo(line: Pick<RefundableLine, 'refundable' | 'refundable_amount'>, quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > line.refundable) return 0;
  const left = kobo(line.refundable_amount);
  return quantity === line.refundable ? left : Math.floor((2 * left * quantity + line.refundable) / (2 * line.refundable));
}

/** Whether a refund is paid at once for this person, or waits for approval (FR-044). */
export function refundWaits(totalKobo: number, info: Pick<Refundable, 'can_approve' | 'refund_threshold'>) {
  return !info.can_approve || (info.refund_threshold != null && totalKobo > kobo(info.refund_threshold));
}
