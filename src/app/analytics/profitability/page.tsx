"use client";
// Analytics › Profitability (Doc 09 "management profitability by product, service, outlet and job"; Doc 12 Reports).
// Revenue net of VAT and returns, the cost of the stock that left, profit and margin; jobs on Chairman.
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { profitabilityAction } from './actions';
import { naira, type Profitability, type ProfitRow } from '@/lib/profitability';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
type View = 'items' | 'outlets' | 'jobs';

function Rows({ rows, first }: { rows: ProfitRow[]; first: string }) {
  return <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
    <thead><tr className="border-b text-left"><th className="p-2">{first}</th><th className="p-2 text-right">Sold</th><th className="p-2 text-right">Revenue</th>
      <th className="p-2 text-right">Cost</th><th className="p-2 text-right">Profit</th><th className="p-2 text-right">Margin</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.item_id ?? `${r.name}-${i}`} className="border-b">
      <td className="p-2">{r.name}{r.kind === 'service' ? <span className="ml-1 text-xs text-muted-foreground">service</span> : null}</td>
      <td className="p-2 text-right">{r.quantity ?? ''}</td><td className="p-2 text-right">{naira(r.revenue)}</td><td className="p-2 text-right">{naira(r.cost)}</td>
      <td className={`p-2 text-right font-medium ${Number(r.profit) < 0 ? 'text-destructive' : ''}`}>{naira(r.profit)}</td>
      <td className="p-2 text-right">{r.margin != null ? `${r.margin}%` : '—'}</td></tr>)}</tbody></table></div>;
}

export default function ProfitabilityPage() {
  const [start, setStart] = React.useState(monthStart), [end, setEnd] = React.useState(today);
  const [view, setView] = React.useState<View>('items');
  const [report, setReport] = React.useState<Profitability | null>(null), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    void profitabilityAction(start, end).then(r => {
      if (!current) return;
      setLoading(false);
      if (r.success) { setReport(r.data); setError(''); } else { setReport(null); setError(r.error); }
    });
    return () => { current = false; };
  }, [start, end]);

  const tabs: { key: View; label: string }[] = [{ key: 'items', label: 'Products and services' }, { key: 'outlets', label: 'Outlets' },
    ...(report?.jobs ? [{ key: 'jobs' as View, label: 'Jobs' }] : [])];
  return <div className="max-w-5xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Profitability</h1>
      <p className="text-muted-foreground">What each product, service, outlet and job earns after its cost.</p></div>
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1"><Label htmlFor="pr-start">From</Label><Input id="pr-start" type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="pr-end">To</Label><Input id="pr-end" type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
    </div>
    {loading ? <p role="status">Loading…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : report && <>
      <p className="rounded-lg bg-muted/50 p-3 text-sm">All sales: {naira(report.totals.revenue)} revenue, {naira(report.totals.cost)} cost,
        <strong> {naira(report.totals.profit)} profit</strong>{report.totals.margin ? ` (${report.totals.margin}% margin)` : ''}. {report.label}.</p>
      <div role="tablist" className="flex gap-2">{tabs.map(t => <button key={t.key} role="tab" aria-selected={view === t.key}
        className={`rounded-md px-3 py-1 text-sm ${view === t.key ? 'bg-primary text-primary-foreground' : 'border'}`} onClick={() => setView(t.key)}>{t.label}</button>)}</div>
      {view === 'items' && (report.items.length ? <Rows rows={report.items} first="Product or service" /> : <p>No sales in this period.</p>)}
      {view === 'outlets' && <Rows rows={report.outlets} first="Outlet" />}
      {view === 'jobs' && report.jobs && (report.jobs.length === 0 ? <p>No jobs completed in this period.</p> :
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th className="p-2">Job</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">Materials</th>
            <th className="p-2 text-right">Labour</th><th className="p-2 text-right">Profit</th></tr></thead>
          <tbody>{report.jobs.map(j => <tr key={j.job_id} className="border-b"><td className="p-2">{j.number}{j.unrated ? <span className="block text-xs text-amber-700">{j.unrated} labour entr{j.unrated === 1 ? 'y has' : 'ies have'} no cost rate</span> : null}</td>
            <td className="p-2 text-right">{naira(j.revenue)}</td><td className="p-2 text-right">{naira(j.materials)}</td><td className="p-2 text-right">{naira(j.labour)}</td>
            <td className={`p-2 text-right font-medium ${Number(j.profit) < 0 ? 'text-destructive' : ''}`}>{naira(j.profit)}</td></tr>)}</tbody></table></div>)}
      <p className="text-xs text-muted-foreground">Revenue is after refunds and credit notes and before VAT. Cost is what the stock that left cost at the time; services have none.</p>
    </>}
  </div>;
}
