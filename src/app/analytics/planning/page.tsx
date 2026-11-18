"use client";
// Analytics › Planning & Budgeting (Doc 03 FR-137; Doc 12 SCR-18; E14 R3 part 3). One budget per financial year: an
// amount for each income and expense account, entered for the year (spread evenly) or month by month.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { budgetAction, saveBudgetAction } from '@/app/analytics/budget-actions';
import { shortMonth, spread, sum, validAmount, type Budget } from '@/lib/budgets';

const thisYear = () => new Date().getFullYear();
const without = (typed: Record<string, string>, id: string) => Object.fromEntries(Object.entries(typed).filter(([k]) => k !== id));

export default function PlanningPage() {
  const [year, setYear] = React.useState(thisYear);
  const [view, setView] = React.useState<Budget | null>(null);
  const [months, setMonths] = React.useState<Record<string, string[]>>({});
  const [open, setOpen] = React.useState<string | null>(null);
  const [typing, setTyping] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const show = (data: Budget) => { setView(data); setTyping({}); setMonths(Object.fromEntries(data.accounts.map(a => [a.id, a.months]))); };
  React.useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setMessage('');
    void budgetAction(year).then(r => {
      if (!current) return;
      setLoading(false);
      if (r.success) show(r.data); else { setView(null); setError(r.error); }
    });
    return () => { current = false; };
  }, [year]);

  const setMonth = (id: string, index: number, value: string) => setMonths(m => ({ ...m, [id]: m[id].map((v, i) => i === index ? value : v) }));
  const save = async () => {
    if (!view) return;
    const bad = view.accounts.find(a => months[a.id].some(v => !validAmount(v || '0')));
    if (bad) { setError(`Check the amounts for ${bad.name}: zero or more, with at most two decimal places.`); return; }
    const lines = view.accounts.map(a => ({ account_id: a.id, months: months[a.id].map(v => (v.trim() || '0')) }))
      .filter(l => l.months.some(v => Number(v) > 0));
    setBusy(true); setError(''); setMessage('');
    const r = await saveBudgetAction(year, lines);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    show(r.data); setMessage(`Budget for ${year} saved.`);
  };

  const total = (kind: 'income' | 'expense') => sum((view?.accounts ?? []).filter(a => a.kind === kind).map(a => sum(months[a.id] ?? [])));
  const groups: { kind: 'income' | 'expense'; title: string }[] = [{ kind: 'income', title: 'Income' }, { kind: 'expense', title: 'Spending' }];

  return <div className="max-w-4xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Planning & Budgeting</h1>
      <p className="text-muted-foreground">Plan what you expect to earn and spend, then compare it with what happens.</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setYear(y => y - 1)}>Previous year</Button>
      <span className="font-medium">Financial year {year}{view ? ` (from ${shortMonth(view.months[0])})` : ''}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setYear(y => y + 1)}>Next year</Button>
      <Link className="ml-auto text-sm underline" href="/analytics/budget-vs-actual">Budget against actual</Link>
    </div>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {loading ? <p role="status">Loading…</p> : view && <>
      {groups.map(({ kind, title }) => <section key={kind} aria-label={title} className="space-y-2 rounded-xl border p-4">
        <h2 className="font-semibold">{title}: ₦{Number(total(kind)).toLocaleString('en-NG', { minimumFractionDigits: 2 })} for the year</h2>
        <ul className="divide-y text-sm">{view.accounts.filter(a => a.kind === kind).map(a => <li key={a.id} className="space-y-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-48 flex-1">{a.code} {a.name}</span>
            <Input aria-label={`Year total for ${a.name}`} className="h-9 w-36" inputMode="decimal" value={typing[a.id] ?? sum(months[a.id] ?? [])} disabled={busy}
              onChange={e => { const v = e.target.value; setTyping(t => ({ ...t, [a.id]: v })); if (validAmount(v || '0')) setMonths(m => ({ ...m, [a.id]: spread(v || '0') })); }}
              onBlur={() => setTyping(t => without(t, a.id))} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(o => o === a.id ? null : a.id)}>{open === a.id ? 'Hide months' : 'By month'}</Button>
          </div>
          {open === a.id && <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{view.months.map((m, i) =>
            <label key={m} className="space-y-1"><span className="text-xs text-muted-foreground">{shortMonth(m)}</span>
              <Input aria-label={`${a.name} in ${shortMonth(m)}`} className="h-9" inputMode="decimal" value={months[a.id][i]} disabled={busy}
                onChange={e => { setTyping(t => without(t, a.id)); setMonth(a.id, i, e.target.value); }} /></label>)}</div>}
        </li>)}</ul>
      </section>)}
      <p className="text-sm">Planned profit for the year: ₦{(Number(total('income')) - Number(total('expense'))).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
        {view.saved_at ? ` · last saved ${new Date(view.saved_at).toLocaleString('en-NG')}` : ' · not saved yet'}</p>
      <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save budget'}</Button>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
