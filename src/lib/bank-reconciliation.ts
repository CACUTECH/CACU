// Bank reconciliation (Doc 03 FR-134; E14 R3): what the accounting API returns, and the column layout of a statement.
export type Layout = { header_row: number; date: number; description: number; amount?: number | null; money_in?: number | null;
  money_out?: number | null; balance?: number | null; date_order: 'DMY' | 'MDY' | 'YMD' };
export type Suggestion = { kind: 'entry' | 'transfer'; transaction_id?: number; transfer_id?: string; number?: string; description: string; date: string; amount: string };
export type StatementLine = { id: string; date: string; description: string; amount: string; balance: string | null;
  status: 'unmatched' | 'matched' | 'explained'; note: string | null; matched_to: string | null; suggestions: Suggestion[] };
export type Unpresented = { transaction_id: number; number: string; description: string; date: string; amount: string };
export type Reconciliation = { accounts: { id: string; name: string }[]; account: string | null; month?: string; lines?: StatementLine[];
  unpresented?: Unpresented[]; statements?: { id: string; file_name: string; lines: number; skipped: number; first_date: string | null; last_date: string | null; imported_at: string }[];
  books_balance?: string; statement_balance?: string | null; summary?: { lines: number; unmatched: number; unpresented: number; reconciled: boolean } };
export type Preview = { rows: string[][]; layout: Layout | null; remembered: boolean };
export type Imported = { statement_id: string; lines: number; already_imported: number; before_books: number };

/** A layout can be imported when it names the date and description and either an amount or both money columns. */
export function complete(layout: Partial<Layout>): layout is Layout {
  return layout.date != null && layout.description != null && layout.header_row != null &&
    (layout.amount != null || (layout.money_in != null && layout.money_out != null));
}
export const money = (value: string) => {
  const n = Number(value);
  return `${n < 0 ? '−' : ''}₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
