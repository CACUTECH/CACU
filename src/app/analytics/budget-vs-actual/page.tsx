"use client";
// Analytics › Budget vs. Actual (Doc 03 FR-145; Doc 12 SCR-18; E14 R3 part 3). A month and the financial year to date,
// each account's budget against what the books show. Income above budget is on track; spending above budget is not.
import * as React from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { comparisonAction } from '@/app/analytics/budget-actions';
import { naira } from '@/lib/vat';
import type { Comparison, Figures } from '@/lib/budgets';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function Cells({ f }: { f: Figures }) {
  return <>
    <td className="p-2 text-right">{naira(f.budget)}</td><td className="p-2 text-right">{naira(f.actual)}</td>
    <td className={`p-2 text-right ${f.on_track ? 'text-emerald-700' : 'text-destructive'}`}>{Number(f.difference) > 0 ? '+' : Number(f.difference) < 0 ? '−' : ''}{naira(String(Math.abs(Number(f.difference))))}{f.percent ? ` (${f.percent}%)` : ''}</td>
  </>;
}

export default function BudgetVsActualPage() {
  const [month, setMonth] = React.useState(thisMonth);
  const [span, setSpan] = React.useState<'month' | 'year_to_date'>('month');
  const [report, setReport] = React.useState<Comparison | null>(null), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    void comparisonAction(month).then(r => {
      if (!current) return;
      setLoading(false);
      if (r.success) { setReport(r.data); setError(''); } else { setReport(null); setError(r.error); }
    });
    return () => { current = false; };
  }, [month]);

  return <div className="max-w-4xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Budget vs. Actual</h1>
      <p className="text-muted-foreground">What you planned against what your books show.</p></div>
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1"><Label htmlFor="bva-month">Month</Label><Input id="bva-month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
      <fieldset className="flex gap-3 text-sm"><legend className="sr-only">Period</legend>
        <label className="flex items-center gap-1"><input type="radio" name="span" checked={span === 'month'} onChange={() => setSpan('month')} />This month</label>
        <label className="flex items-center gap-1"><input type="radio" name="span" checked={span === 'year_to_date'} onChange={() => setSpan('year_to_date')} />Year to date</label>
      </fieldset>
    </div>
    {loading ? <p role="status">Loading…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : report && <>
      {!report.has_budget && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">There is no budget for this financial year yet. <Link className="underline" href="/analytics/planning">Set one</Link> to compare.</p>}
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Account</th><th className="p-2 text-right">Budget</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Difference</th></tr></thead>
        <tbody>
          {(['income', 'expense'] as const).map(kind => <React.Fragment key={kind}>
            <tr className="bg-muted/40"><th colSpan={4} className="p-2 text-left">{kind === 'income' ? 'Income' : 'Spending'}</th></tr>
            {report.lines.filter(l => l.kind === kind).map(l => <tr key={l.account_id} className="border-b"><td className="p-2">{l.code} {l.name}</td><Cells f={l[span]} /></tr>)}
            <tr className="border-b font-medium"><td className="p-2">Total {kind === 'income' ? 'income' : 'spending'}</td><Cells f={report.totals[kind][span]} /></tr>
          </React.Fragment>)}
          <tr className="font-semibold"><td className="p-2">Profit</td><Cells f={report.totals.profit[span]} /></tr>
        </tbody>
      </table></div>
      <p className="text-sm text-muted-foreground">{span === 'year_to_date' ? `From ${report.year_from} to the end of the month chosen. ` : ''}Green is on track: income at or above budget, spending at or below it.</p>
    </>}
  </div>;
}
