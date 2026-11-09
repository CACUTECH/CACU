// Credit notes on invoices (Doc 10 E12, Doc 09 PR-16): types shared by the dialog, the list and their tests.
import { naira } from '@/lib/receivables';

export { naira };
export type CreditableLine = { line_id: string; item_id: string | null; name: string; quantity: number; line_total: string;
  creditable_units: number; creditable_amount: string; restockable: boolean };
export type Creditable = { invoice_id: string; invoice_number: string; customer_id: string; customer_name: string | null; total: string;
  credited_total: string; outstanding: string; lines: CreditableLine[]; refund_threshold: string | null; can_approve: boolean };
export type CreditStatus = 'pending' | 'posted' | 'rejected';
export type CreditNote = { id: string; number: string; invoice_id: string; invoice_number: string; customer_id: string; customer_name: string | null;
  amount: string; items: string | null; reason: string; status: CreditStatus; requested_by_name: string; requested_at: string;
  decided_on: string | null; decision_note: string | null; against_invoice: string | null; to_advance: string | null;
  posting: { credit_note: string | null; advance: string | null; stock_cost_restored: string } | null; mine: boolean };
export type CreditNoteList = { can_approve: boolean; credit_notes: CreditNote[] };
export type CreditLineInput = { line_id: string; quantity: number; amount: string | null; restock: boolean };

export const CREDIT_STATUS: Record<CreditStatus, string> = { pending: 'Waiting for approval', posted: 'Posted', rejected: 'Rejected' };

const kobo = (value: string) => Math.round(Number(value) * 100);

// What a line credits, as the server works it out: units take their share of what is left on the line (the last units
// take all of it); an amount off is taken as entered. error is set when the entry is not valid.
export function lineCredit(line: CreditableLine, units: string, off: string): { value: number; error: string | null } {
  const u = units.trim(), a = off.trim();
  if (!u && !a) return { value: 0, error: null };
  if (u && a) return { value: 0, error: `For ${line.name}, give back units or take an amount off, not both.` };
  if (u) {
    if (!/^[0-9]{1,7}$/.test(u)) return { value: 0, error: `Enter whole units for ${line.name}.` };
    const n = Number(u);
    if (n > line.creditable_units) return { value: 0, error: line.creditable_units ? `Only ${line.creditable_units} x ${line.name} can still be credited.` : `${line.name} has already been credited in full.` };
    if (n === 0) return { value: 0, error: null };
    const left = kobo(line.creditable_amount);
    return { value: (n === line.creditable_units ? left : Math.round(left * n / line.creditable_units)) / 100, error: null };
  }
  if (!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(a)) return { value: 0, error: `Enter the amount off ${line.name} in naira.` };
  if (kobo(a) > kobo(line.creditable_amount)) return { value: 0, error: `At most ${naira(line.creditable_amount)} can still be taken off ${line.name}.` };
  return { value: kobo(a) / 100, error: null };
}
