// Receivables (Doc 10 E11): shapes returned by the accounting API for open invoices, payments, ageing and statements.
export type OpenInvoice = { id: string; invoice_number: string; issue_date: string | null; due_date: string | null; total: string; outstanding: string; waiting: string; open: string };
export type OpenItems = { customer: { id: string; name: string }; invoices: OpenInvoice[]; open_total: string; advance: string };
export type PaymentResult = { id: string; status: 'posted' | 'awaiting_confirmation'; amount: string; allocated: string; advance: string };
export type AgeingDocument = { id: string; number: string; date: string; due_date: string; days_overdue: number; bucket: string; outstanding: string };
export type AgeingRow = { party_id: string | null; name: string; current: string; d1_30: string; d31_60: string; d61_90: string; over_90: string;
  total: string; advance: string; net: string; documents: AgeingDocument[] };
export type Ageing = { type: 'receivables' | 'payables'; as_of: string; buckets: { key: keyof AgeingRow; label: string }[]; rows: AgeingRow[];
  totals: Record<string, string> };
export type StatementLine = { date: string; kind: string; reference: string; debit: string; credit: string; balance: string };
export type Statement = { customer: { id: string; name: string }; start: string; end: string; opening: string; closing: string; lines: StatementLine[]; advance_held: string };

const cents = (value: string) => Math.round(Number(value) * 100);
export const fromCents = (value: number) => (value / 100).toFixed(2);

/** Splits a payment across open invoices, oldest due first; what is left over is the customer's advance. */
export function splitOldestFirst(amount: string, invoices: OpenInvoice[]): Record<string, string> {
  let left = /^\d{1,13}(\.\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const parts: Record<string, string> = {};
  for (const invoice of invoices) {
    const part = Math.min(left, cents(invoice.open));
    parts[invoice.id] = part > 0 ? fromCents(part) : '';
    left -= Math.max(part, 0);
  }
  return parts;
}

export const naira = (value: string | number) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const lagosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
export const sumCents = (values: string[]) => values.reduce((total, v) => total + (/^\d{1,13}(\.\d{1,2})?$/.test(v) ? cents(v) : 0), 0);
