"use client";
// Receivables and payables ageing (Doc 10 E11, Doc 09 statement set, Doc 11 GET /reports/ageing): what customers owe and
// what is owed to suppliers at a date, by how long it is past its due date, from the posted books.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ageingAction } from '@/app/invoices/receivables-actions';
import { lagosToday, naira, type Ageing, type AgeingRow } from '@/lib/receivables';

const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export default function AgeingPage() {
  const [type, setType] = React.useState<'receivables' | 'payables'>('receivables');
  const [asOf, setAsOf] = React.useState(lagosToday());
  const [report, setReport] = React.useState<Ageing | null | undefined>(undefined), [error, setError] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReport(undefined); setError(''); setOpen(null);
    if (!asOf) return;
    let live = true;
    void ageingAction(type, asOf).then(r => { if (!live) return; if (r.success) setReport(r.data); else { setError(r.error); setReport(null); } });
    return () => { live = false; };
  }, [type, asOf]);

  const party = type === 'receivables' ? 'Customer' : 'Supplier';
  const download = () => {
    if (!report) return;
    const head = [party, ...report.buckets.map(b => b.label), 'Total', ...(type === 'receivables' ? ['Advance held', 'Net owed'] : [])];
    const rows = report.rows.map(r => [r.name, ...report.buckets.map(b => r[b.key] as string), r.total, ...(type === 'receivables' ? [r.advance, r.net] : [])]);
    const blob = new Blob([[head, ...rows].map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `cacu-${type}-ageing-${asOf}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const cell = (row: AgeingRow, key: keyof AgeingRow) => Number(row[key]) ? naira(row[key] as string) : '–';

  return <div className="space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Receivables & Payables Ageing</h1>
      <p className="text-muted-foreground">What is owed at a date, by how long it is past its due date. Documents without a due date count from their date. Management report, not reviewed.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <div role="radiogroup" aria-label="Report" className="flex rounded-lg border p-1">
        {(['receivables', 'payables'] as const).map(t => <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)}
          className={`rounded-md px-3 py-1.5 text-sm ${type === t ? 'bg-primary text-primary-foreground' : ''}`}>{t === 'receivables' ? 'Customers owe you' : 'You owe suppliers'}</button>)}
      </div>
      <div className="space-y-1"><Label htmlFor="ageing-date">As at</Label><Input id="ageing-date" type="date" value={asOf} max={lagosToday()} onChange={e => setAsOf(e.target.value)} /></div>
      <Button variant="outline" disabled={!report || report.rows.length === 0} onClick={download}>Download CSV</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {report === undefined && !error && <p role="status" className="text-muted-foreground">Loading…</p>}
    {report === null && !error && <p className="text-muted-foreground">Ageing is worked out from your books. Turn on your books to see it.</p>}
    {report && (report.rows.length === 0 ? <p className="text-muted-foreground">Nothing is owed {type === 'receivables' ? 'to you' : 'to suppliers'} on {report.as_of}.</p>
      : <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">{party}</th>
          {report.buckets.map(b => <th key={b.key} className="p-2 text-right">{b.label}</th>)}<th className="p-2 text-right">Total</th>
          {type === 'receivables' && <th className="p-2 text-right">Advance held</th>}</tr></thead>
        <tbody>{report.rows.map(r => { const id = r.party_id ?? r.name; return <React.Fragment key={id}>
          <tr className="border-b"><td className="p-2"><button className="text-left font-medium underline-offset-2 hover:underline" aria-expanded={open === id}
            onClick={() => setOpen(open === id ? null : id)}>{r.name}</button>
            {type === 'receivables' && r.party_id && <Link className="block text-xs text-muted-foreground underline" href={`/invoices/statement?customer=${r.party_id}`}>Statement</Link>}</td>
            {report.buckets.map(b => <td key={b.key} className={`p-2 text-right ${b.key === 'over_90' && Number(r.over_90) ? 'text-destructive' : ''}`}>{cell(r, b.key)}</td>)}
            <td className="p-2 text-right font-semibold">{naira(r.total)}</td>{type === 'receivables' && <td className="p-2 text-right">{cell(r, 'advance')}</td>}</tr>
          {open === id && <tr className="border-b bg-muted/40"><td colSpan={report.buckets.length + (type === 'receivables' ? 3 : 2)} className="p-2">
            <ul className="space-y-1">{r.documents.map(d => <li key={d.id}>{d.number}: {naira(d.outstanding)} owed, dated {d.date}, due {d.due_date}
              {d.days_overdue > 0 ? `, ${d.days_overdue} days late` : ', not yet due'}</li>)}</ul></td></tr>}
        </React.Fragment>; })}</tbody>
        <tfoot><tr className="font-semibold"><td className="p-2">Total</td>{report.buckets.map(b => <td key={b.key} className="p-2 text-right">{naira(report.totals[b.key])}</td>)}
          <td className="p-2 text-right">{naira(report.totals.total)}</td>{type === 'receivables' && <td className="p-2 text-right">{naira(report.totals.advance)}</td>}</tr></tfoot>
      </table></div>)}
  </div>;
}
