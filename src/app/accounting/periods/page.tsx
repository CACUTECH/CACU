"use client";
// Accounting › Month Close (Doc 09 month-end checklist, FR-135; E14 R3 part 1). Months close in order once they have
// ended. The books must balance and receivables, payables and stock must match their accounts; every other step is
// ticked or explained. A closed month takes no entries. Only the Owner reopens the latest closed month, with a reason.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { closeMonthAction, closeYearAction, periodsAction, reopenMonthAction, reopenYearAction } from '@/app/accounting/periods/actions';
import { monthName, unanswered, type Answer, type PeriodOverview } from '@/lib/periods';

const STATUS = { open: 'Open', closed: 'Closed', reopened: 'Reopened' } as const;

export default function MonthClosePage() {
  const [view, setView] = React.useState<PeriodOverview | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState('');
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({});
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  React.useEffect(() => { void periodsAction().then(r => { if (r.success) setView(r.data); else { setView(null); setLoadError(r.error); } }); }, []);

  const answer = (key: string, change: Partial<Answer>) =>
    setAnswers(a => ({ ...a, [key]: { done: a[key]?.done ?? false, note: a[key]?.note ?? '', ...change } }));

  const close = async () => {
    if (!view?.next_to_close) return;
    const missing = unanswered(view.checklist, answers);
    if (missing.length) { setError(`Tick or explain: ${missing[0].label}.`); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await closeMonthAction(view.next_to_close, answers);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setMessage(`${monthName(view.next_to_close)} is closed. Nothing can be entered in it now.`);
    setView(r.data); setAnswers({});
  };
  const [reopeningYear, setReopeningYear] = React.useState<number | null>(null);
  const [yearReason, setYearReason] = React.useState('');
  const yearAction = async (work: () => Promise<{ success: true } | { success: false; error: string }>, done: string) => {
    setBusy(true); setError(''); setMessage('');
    const r = await work();
    if (!r.success) { setBusy(false); setError(r.error); return; }
    const fresh = await periodsAction();
    setBusy(false);
    if (fresh.success) setView(fresh.data);
    setMessage(done); setReopeningYear(null);
  };
  const reopen = async () => {
    if (!view?.latest_closed) return;
    if (reason.trim().length < 5) { setError('Say why the month needs reopening.'); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await reopenMonthAction(view.latest_closed, reason.trim());
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setMessage(`${monthName(view.latest_closed)} is open again.`);
    setView(r.data); setReason('');
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Month close</h1>
    <p className="text-muted-foreground">Check a finished month and lock it, so its figures cannot change.</p></div>;
  if (view === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (view === null) return <div className="space-y-4">{heading}<p role="alert">{loadError}</p></div>;

  const blocked = view.checklist.filter(s => s.blocking && !s.passed);
  const latestClosedYear = view.years?.filter(y => y.status === 'closed').reduce((m, y) => Math.max(m, y.year), 0) ?? 0;
  return <div className="max-w-3xl space-y-6">{heading}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {view.next_to_close ? <section aria-label="Close the next month" className="space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">Close {monthName(view.next_to_close)}</h2>
      <ul className="space-y-3">{view.checklist.map(step =>
        <li key={step.key} className="rounded-lg border p-3">
          <p className="font-medium">{step.passed ? '✓' : step.blocking ? '✗' : '•'} {step.label}</p>
          {step.detail && <p className={`text-sm ${step.blocking ? 'text-destructive' : 'text-muted-foreground'}`}>{step.detail}</p>}
          {step.needs_answer && <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={answers[step.key]?.done ?? false} disabled={busy} onChange={e => answer(step.key, { done: e.target.checked })} />Done
            </label>
            <Input aria-label={`Or explain: ${step.label}`} placeholder="Or explain why not" value={answers[step.key]?.note ?? ''} maxLength={500}
              disabled={busy} onChange={e => answer(step.key, { note: e.target.value })} />
          </div>}
        </li>)}</ul>
      {blocked.length > 0 && <p className="text-sm text-destructive">Fix the steps marked ✗ before closing. They mean the books do not agree.</p>}
      <Button type="button" disabled={busy || blocked.length > 0} onClick={() => void close()}>{busy ? 'Closing…' : `Close ${monthName(view.next_to_close)}`}</Button>
    </section> : <p>There is no finished month to close yet.</p>}

    {view.latest_closed && <section aria-label="Reopen a month" className="space-y-2 rounded-xl border p-4">
      <h2 className="font-semibold">Reopen {monthName(view.latest_closed)}</h2>
      <p className="text-sm text-muted-foreground">Only the owner can reopen, and only the latest closed month. The reason is kept.</p>
      <div className="space-y-1"><Label htmlFor="reopen-reason">Why does it need reopening?</Label>
        <Input id="reopen-reason" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void reopen()}>{busy ? 'Reopening…' : 'Reopen month'}</Button>
    </section>}
    {error && <p role="alert" className="text-destructive">{error}</p>}

    {(view.years?.length ?? 0) > 0 && <section aria-label="Years" className="space-y-2 rounded-xl border p-4">
      <h2 className="font-semibold">Years</h2>
      <p className="text-sm text-muted-foreground">Close a finished year once all its months are closed. Its months are then locked, and its profit shows as retained
        earnings on the balance sheet. Nothing is posted; the owner can reopen the latest closed year, with a reason.</p>
      <ul className="divide-y text-sm">{view.years!.map(y => <li key={y.year} className="space-y-2 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span><span className="font-medium">Year to {monthName(y.end.slice(0, 7) + '-01')}</span>
            <span className="block text-xs text-muted-foreground">{y.status === 'closed' ? `Closed · profit ₦${Number(y.profit).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
              : !y.ended ? 'In progress' : y.months_open.length ? `${y.months_open.length} month${y.months_open.length === 1 ? '' : 's'} still open` : 'Ready to close'}</span></span>
          {y.status === 'open' && y.ended && y.months_open.length === 0 && <Button size="sm" disabled={busy} onClick={() => void yearAction(() => closeYearAction(y.year), `The year to ${monthName(y.end.slice(0, 7) + '-01')} is closed.`)}>Close year</Button>}
          {y.status === 'closed' && y.year === latestClosedYear && reopeningYear !== y.year && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setReopeningYear(y.year); setYearReason(''); }}>Reopen year</Button>}
        </div>
        {reopeningYear === y.year && <form aria-label="Reopen this year" className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault();
          if (yearReason.trim().length < 5) { setError('Say why the year needs reopening.'); return; }
          void yearAction(() => reopenYearAction(y.year, yearReason.trim()), `The year to ${monthName(y.end.slice(0, 7) + '-01')} is open again.`); }}>
          <Input aria-label="Why does the year need reopening?" placeholder="Why does the year need reopening?" value={yearReason} maxLength={500} onChange={e => setYearReason(e.target.value)} className="max-w-sm" />
          <Button type="submit" size="sm" disabled={busy}>Reopen</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setReopeningYear(null)}>Cancel</Button>
        </form>}
      </li>)}</ul>
    </section>}

    <section aria-label="Months" className="space-y-2">
      <h2 className="font-semibold">Months</h2>
      <ul className="divide-y rounded-xl border text-sm">{view.months.map(m =>
        <li key={m.month} className="flex justify-between p-3"><span>{monthName(m.month)}</span><span>{STATUS[m.status]}</span></li>)}</ul>
      {view.history.length > 0 && <ul className="text-sm text-muted-foreground">{view.history.map((h, i) =>
        <li key={i}>{h.event === 'period_closed' ? 'Closed' : 'Reopened'} {monthName(h.month)} on {new Date(h.at).toLocaleDateString('en-NG')}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul>}
    </section>
  </div>;
}
