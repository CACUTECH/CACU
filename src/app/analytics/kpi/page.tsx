"use client";
// Analytics › KPIs (Doc 12 SCR-18; Doc 05 BO-03; E16 R3). The period's key figures against the period before, and the
// position at its end, all from the posted books. Nothing estimated: what the books cannot give is not shown.
import * as React from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { kpisAction } from './actions';
import { better, show, type Kpis } from '@/lib/kpis';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

export default function KpiPage() {
  const [start, setStart] = React.useState(monthStart), [end, setEnd] = React.useState(today);
  const [data, setData] = React.useState<Kpis | null>(null), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    void kpisAction(start, end).then(r => {
      if (!current) return;
      setLoading(false);
      if (r.success) { setData(r.data); setError(''); } else { setData(null); setError(r.error); }
    });
    return () => { current = false; };
  }, [start, end]);

  return <div className="max-w-5xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Key Performance Indicators</h1>
      <p className="text-muted-foreground">How the business did this period, against the period before.</p></div>
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1"><Label htmlFor="kpi-start">From</Label><Input id="kpi-start" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="kpi-end">To</Label><Input id="kpi-end" type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
    </div>
    {loading ? <p role="status">Loading…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : data && <>
      {data.exceptions.length > 0 && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">
        <p className="font-medium text-destructive">Your books do not reconcile, so these figures may be wrong:</p>
        <ul className="list-disc pl-5">{data.exceptions.map(e => <li key={e.message}>{e.message}</li>)}</ul></div>}
      <section aria-label="This period" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.figures.map(f => {
        const good = better(f);
        return <div key={f.key} className="rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">{f.label}</p>
          <p className="text-2xl font-semibold tabular-nums">{show(f.value, f.kind)}</p>
          {f.previous != null && <p className="text-xs text-muted-foreground">Before: {show(f.previous, f.kind)}
            {f.change != null && <span className={good == null ? '' : good ? ' text-emerald-700' : ' text-destructive'}> ({Number(f.change) > 0 ? '+' : ''}{f.change}%)</span>}</p>}
        </div>;
      })}</section>
      <section aria-label="At the end of the period" className="space-y-2">
        <h2 className="font-semibold">At {data.period.end_date}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.at_end.map(a => <div key={a.key} className="rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">{a.label}</p><p className="text-xl font-semibold tabular-nums">{show(a.value)}</p>
          {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}</div>)}</div>
      </section>
      <p className="text-xs text-muted-foreground">{data.label}. Compared with {data.previous_period.start_date} to {data.previous_period.end_date}.
        {' '}See the <Link className="underline" href="/reports">statements</Link> and <Link className="underline" href="/analytics/profitability">profitability</Link> for the detail.</p>
    </>}
  </div>;
}
