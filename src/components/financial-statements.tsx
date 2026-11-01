"use client";
import { useRef, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatNgn } from '@/lib/cash-flow';
import type { FinancialStatements, StatementSection } from '@/lib/ledger-reports';
import { getStatementsAction } from '@/app/reports/actions';

type View = 'income' | 'position';
type Row = { label: string; amounts: string[]; kind?: 'heading' | 'total' | 'grand' };
const TITLES: Record<View, string> = { income: 'Statement of Profit or Loss', position: 'Statement of Financial Position' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

function sectionRows(section: StatementSection): Row[] {
  if (!section.lines.length) return [];
  return [{ label: section.title, amounts: [], kind: 'heading' },
    ...section.lines.map(line => ({ label: line.code ? `${line.code} ${line.name}` : line.name, amounts: line.amounts })),
    { label: `Total ${section.title.toLowerCase()}`, amounts: section.total, kind: 'total' }];
}

/** The rows a statement shows, also used for its exports so the screen and the files always agree. */
export function statementRows(data: FinancialStatements, view: View): Row[] {
  const by = (sections: StatementSection[]) => Object.fromEntries(sections.map(s => [s.key, s]));
  if (view === 'income') {
    const s = by(data.income_statement.sections);
    return [...sectionRows(s.revenue), ...sectionRows(s.cost_of_sales), { label: 'Gross profit', amounts: data.income_statement.gross_profit, kind: 'total' },
      ...sectionRows(s.operating_expenses), ...sectionRows(s.other_income), ...sectionRows(s.other_expenses),
      { label: data.income_statement.net_profit[0].startsWith('-') ? 'Net loss' : 'Net profit', amounts: data.income_statement.net_profit, kind: 'grand' }];
  }
  const s = by(data.financial_position.sections), p = data.financial_position;
  return [...sectionRows(s.current_assets), ...sectionRows(s.non_current_assets), { label: 'Total assets', amounts: p.total_assets, kind: 'grand' },
    ...sectionRows(s.current_liabilities), ...sectionRows(s.non_current_liabilities), { label: 'Total liabilities', amounts: p.total_liabilities, kind: 'total' },
    ...sectionRows(s.equity), { label: 'Total liabilities and equity', amounts: p.total_liabilities.map((l, i) => (Number(l) + Number(p.total_equity[i])).toFixed(2)), kind: 'grand' }];
}

export function columnHeadings(data: FinancialStatements, view: View) {
  return data.periods.map(p => view === 'income' ? `${p.start_date} to ${p.end_date}` : `As of ${p.end_date}`);
}

/** FR-140 to FR-142 with Doc 09 presentation rules: labels, an optional comparison column, exceptions before the figures, PDF and Excel. */
export function FinancialStatementsPanel({ view }: { view: View }) {
  const { business } = useBusiness();
  const [start, setStart] = useState(`${today().slice(0, 7)}-01`), [end, setEnd] = useState(today());
  const [compare, setCompare] = useState<'prior' | 'last_year' | ''>('');
  const [data, setData] = useState<FinancialStatements | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const version = useRef(0);
  const reset = () => { version.current++; setData(null); setLoading(false); };
  async function load(event: React.FormEvent) {
    event.preventDefault();
    const mine = ++version.current; setLoading(true); setError(''); setData(null);
    const result = await getStatementsAction(start, end, compare);
    if (mine !== version.current) return;
    if (result.success) setData(result.data); else setError(result.error);
    setLoading(false);
  }
  const title = TITLES[view];
  const header = (d: FinancialStatements) => [business?.name || 'Business', title, `${d.tier} · ${d.basis} basis · ${d.currency}`, `Generated ${d.generated_at.replace('T', ' ')}`];
  async function exportFile(kind: 'excel' | 'pdf') {
    if (!data) return;
    const rows = statementRows(data, view), headings = columnHeadings(data, view);
    const notes = data.exceptions.map(e => `Exception: ${e.message}`);
    const file = `${view === 'income' ? 'profit-or-loss' : 'financial-position'}-${data.periods[0].start_date}-${data.periods[0].end_date}`;
    if (kind === 'excel') {
      const XLSX = await import('xlsx'); const book = XLSX.utils.book_new();
      const sheet = [...header(data).map(h => [h]), ...notes.map(n => [n]), [], ['', ...headings],
        ...rows.map(r => [r.label, ...r.amounts.map(Number)])];
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), view === 'income' ? 'Profit or loss' : 'Financial position');
      XLSX.writeFile(book, `${file}.xlsx`);
    } else {
      const { jsPDF } = await import('jspdf'); const { default: autoTable } = await import('jspdf-autotable');
      const pdf = new jsPDF();
      [...header(data), ...notes].forEach((line, i) => pdf.text(line, 14, 15 + i * 7));
      autoTable(pdf, { startY: 22 + (header(data).length + notes.length) * 7, head: [['', ...headings]],
        body: rows.map(r => [r.label, ...r.amounts.map(a => formatNgn(a))]) });
      pdf.save(`${file}.pdf`);
    }
  }
  return <Card className="rounded-xl"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>Posted ledger · NGN</CardDescription></CardHeader><CardContent className="space-y-4">
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-muted/30 p-4" onSubmit={event => void load(event)}>
      <label className="space-y-1 text-sm"><span>From</span><Input type="date" required value={start} onChange={e => { reset(); setStart(e.target.value); }}/></label>
      <label className="space-y-1 text-sm"><span>To</span><Input type="date" required value={end} onChange={e => { reset(); setEnd(e.target.value); }}/></label>
      <label className="space-y-1 text-sm"><span>Compare with</span><select aria-label="Compare with" className="block rounded-md border bg-background p-2" value={compare}
        onChange={e => { reset(); setCompare(e.target.value as typeof compare); }}><option value="">No comparison</option><option value="prior">The period before</option><option value="last_year">Same period last year</option></select></label>
      <Button type="submit" disabled={loading || !start || !end || start > end}>{loading ? 'Loading…' : 'Run report'}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">{business?.name ? `${business.name} · ` : ''}{data.tier} · {data.basis} basis · {data.currency} · generated {data.generated_at.replace('T', ' ')}</p>
      {data.exceptions.length > 0 && <div role="alert" className="space-y-1 rounded-md border border-destructive p-3">
        <p className="font-medium text-destructive">These figures do not reconcile. Check them before relying on this report.</p>
        <ul className="list-disc pl-5 text-sm">{data.exceptions.map(e => <li key={e.message}>{e.message}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void exportFile('excel')}>Excel</Button><Button variant="outline" onClick={() => void exportFile('pdf')}>PDF</Button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
        <thead><tr><th className="p-2 text-left" />{columnHeadings(data, view).map(h => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
        <tbody>{statementRows(data, view).map((row, i) => <tr key={`${row.label}-${i}`} className={row.kind === 'heading' ? '' : 'border-t'}>
          <td className={`p-2 ${row.kind === 'heading' ? 'pt-4 font-semibold' : row.kind ? 'font-semibold' : 'pl-4'}`}>{row.label}</td>
          {row.amounts.map((amount, j) => <td key={j} className={`p-2 text-right tabular-nums ${row.kind ? 'font-semibold' : ''}`}>{formatNgn(amount)}</td>)}
        </tr>)}</tbody>
      </table></div>
    </>}
  </CardContent></Card>;
}
