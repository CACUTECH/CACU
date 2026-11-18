// Key performance indicators (E16 R3): what the accounting API returns.
export type Figure = { key: string; label: string; value: string; previous: string | null; change: string | null; kind: 'money' | 'count' | 'percent'; good: 'up' | 'down' };
export type AtEnd = { key: string; label: string; value: string; detail?: string };
export type Kpis = { period: { start_date: string; end_date: string }; previous_period: { start_date: string; end_date: string }; label: string;
  exceptions: { check: string; message: string }[]; figures: Figure[]; at_end: AtEnd[] };

export function show(value: string, kind: Figure['kind'] = 'money'): string {
  if (kind === 'count') return Number(value).toLocaleString('en-NG');
  if (kind === 'percent') return `${value}%`;
  const n = Number(value);
  return `${n < 0 ? '−' : ''}₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Whether a change is good news: revenue and profit going up, spending going down. */
export function better(f: Figure): boolean | null {
  if (f.change == null || Number(f.change) === 0) return null;
  return (Number(f.change) > 0) === (f.good === 'up');
}
