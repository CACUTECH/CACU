// Purchasing (Doc 10 inventory purchase-to-payment): purchase orders to suppliers. An order changes nothing in the
// books; stock and the liability arise when goods arrive.
export type OrderStatus = 'draft' | 'sent' | 'partly_received' | 'received' | 'cancelled';
export type PurchaseOrder = {
  id: string; number: string; supplier_id: string; status: OrderStatus; expected_date: string | null; notes: string;
  created_at: string; sent_at: string | null; cancel_reason: string | null;
};
export type OrderLine = { id: string; item_id: string; quantity: number; unit_cost: number | string; received_quantity: number };
export type Supplier = { id: string; name: string; phone: string | null; email: string | null };

export const ORDER_STATUS: Record<OrderStatus, string> = {
  draft: 'Draft', sent: 'Sent', partly_received: 'Partly received', received: 'Received', cancelled: 'Cancelled',
};
export const ORDER_COLUMNS = 'id, number, supplier_id, status, expected_date, notes, created_at, sent_at, cancel_reason';

const MESSAGES: Record<string, string> = {
  ORDER_EMPTY: 'Add at least one item before sending the order.',
  ORDER_SENT: 'This order has been sent. Cancel it and make a new one to change it.',
  ORDER_CLOSED: 'This order is received or cancelled and can no longer change.',
  ORDER_STATE_INVALID: 'This order has already moved on. Refresh to see its latest state.',
  ORDER_RECEIVED_BY_API: 'Goods are received with Receive goods, not by editing the order.',
  CANCEL_REASON_REQUIRED: 'Say why the order is cancelled.',
  ITEM_UNAVAILABLE: 'Only active products whose stock you track can be ordered.',
  SUPPLIER_UNAVAILABLE: 'Choose one of your suppliers.',
  SUBSCRIPTION_READ_ONLY: 'Your workspace is read-only until the subscription is paid.',
};

/** A database refusal in plain words. */
export function orderError(error: { message?: string; code?: string } | null | undefined, fallback = 'The change was not saved. Refresh and try again.') {
  const message = error?.message ?? '';
  const known = Object.keys(MESSAGES).find(code => message.includes(code));
  if (known) return MESSAGES[known];
  if (error?.code === '23505') return 'That item is already on the order. Change its quantity instead.';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'You cannot do this. Your plan may not include purchasing, or you may not have permission. Ask the business owner.';
  }
  return fallback;
}

/** The order total in kobo: each line's quantity times its unit cost, rounded half up to the kobo. */
export function orderTotalKobo(lines: Pick<OrderLine, 'quantity' | 'unit_cost'>[]) {
  return lines.reduce((sum, l) => sum + Math.round(Number(l.unit_cost) * l.quantity * 100), 0);
}

/** The order as plain text for WhatsApp or email to the supplier. */
export function orderText(order: Pick<PurchaseOrder, 'number' | 'expected_date' | 'notes'>, business: string, supplier: string,
  lines: { name: string; quantity: number; unit_cost: number | string }[]) {
  const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    `Purchase order ${order.number} from ${business}`, `To: ${supplier}`,
    ...lines.map(l => `${l.quantity} x ${l.name} at ${naira(Math.round(Number(l.unit_cost) * 100))}`),
    `Total: ${naira(orderTotalKobo(lines))}`,
    order.expected_date ? `Please deliver by ${order.expected_date}.` : null,
    order.notes ? order.notes : null,
  ].filter(Boolean).join('\n');
}

/** A Nigerian phone number in WhatsApp's international form (234...), or null when it can't be read. */
export function whatsappNumber(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  return null;
}
