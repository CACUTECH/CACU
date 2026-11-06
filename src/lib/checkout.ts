// POS checkout (Doc 10): discounts, change and the receipt, worked in kobo so the till agrees with the server.
export type CheckoutOptions = { discount_cap: string; allow_oversell: boolean };
export type SaleReceipt = {
  id: string; number: string; date: string; status: string; method: string;
  subtotal: string; discount_total: string; total: string; cash_received: string | null; change: string | null; transfer_amount: string | null;
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
    `Total: ₦${r.total}`, paid, r.change ? `Change: ₦${r.change}` : null].filter(Boolean).join('\n');
}
