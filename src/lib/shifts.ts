// Cashier shifts (Doc 10 shifts, PR-22): the float, the cash tagged to the shift, and the count at close.
import { kobo, nairaText } from '@/lib/checkout';

export type ShiftMovement = { id: string; kind: 'pay_in' | 'pay_out'; destination: 'expense' | 'bank'; amount: string; reason: string; created_at: string };
export type Shift = {
  id: string; status: 'open' | 'closed'; opened_by_name: string; mine: boolean; opened_at: string; opened_on: string; overdue: boolean;
  opening_float: string; sales: number; cash_sales: string; cash_refunds: string; pay_ins: string; pay_outs: string; cash_handed_back: string; deposits?: string;
  expected_cash: string; counted_cash: string | null; variance: string | null; close_note: string | null; closed_on: string | null;
  movements?: ShiftMovement[];
};
export type ShiftStatus = {
  available: boolean; require_shift: boolean; shift: Shift | null; can_manage: boolean;
  pay_out_accounts?: { id: string; code: string; name: string }[];
};
export type ShiftsDay = { closed: Shift[]; open: Shift[]; variance_total: string };

export const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

/** Counted less expected, in kobo; null until a valid count is entered. */
export function differenceKobo(counted: string, expected: string): number | null {
  return AMOUNT.test(counted.trim()) ? kobo(counted.trim()) - kobo(expected) : null;
}

/** "₦300.00 short", "₦100.00 over", or "No difference". */
export function differenceText(value: number | string) {
  const k = typeof value === 'number' ? value : kobo(value);
  return k === 0 ? 'No difference' : `${nairaText(Math.abs(k))} ${k < 0 ? 'short' : 'over'}`;
}

/** The time a shift opened, for example "08:05". */
export function openedAt(shift: Pick<Shift, 'opened_at'>) {
  return new Date(shift.opened_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}
