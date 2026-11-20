"use client";
// Stock › Stock counts (Doc 18 R3 "E09 counts"; Doc 09 month-end step 4). Count what is on the shelf; submit; an Owner or
// Admin who did not submit the count approves it once, which posts every difference to Inventory adjustments.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { countAction, countsAction, decideCountAction, saveCountAction, startCountAction, submitCountAction } from './actions';
import { quantity, STATUS, type StockCount } from '@/lib/stock-counts';

export default function StockCountsPage() {
  const [counts, setCounts] = React.useState<StockCount[] | null>(null);
  const [open, setOpen] = React.useState<StockCount | null>(null);
  const [typed, setTyped] = React.useState<Record<string, string>>({});
  const [name, setName] = React.useState(() => `Count of ${new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  const [note, setNote] = React.useState(''), [key] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const show = (count: StockCount) => { setOpen(count); setTyped(Object.fromEntries((count.lines ?? []).map(l => [l.item_id, l.counted == null ? '' : String(l.counted)]))); };
  const load = React.useCallback(async () => {
    const r = await countsAction();
    if (!r.success) { setError(r.error); setCounts([]); return; }
    setCounts(r.data);
    const current = r.data.find(c => c.status === 'counting' || c.status === 'submitted');
    if (current) { const full = await countAction(current.id); if (full.success) show(full.data); } else setOpen(null);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const step = async (work: () => Promise<{ success: true; data: StockCount } | { success: false; error: string }>, done: string) => {
    setBusy(true); setError(''); setMessage('');
    const r = await work();
    setBusy(false);
    if (!r.success) { setError(r.error); return false; }
    show(r.data); setMessage(done); return true;
  };
  const entered = () => {
    const lines = (open?.lines ?? []).map(l => ({ item_id: l.item_id, counted: quantity(typed[l.item_id] ?? '') }));
    const bad = lines.find(l => l.counted === undefined);
    if (bad) { setError(`Enter a whole number for ${open?.lines?.find(l => l.item_id === bad.item_id)?.name}, or leave it empty.`); return null; }
    return lines as { item_id: string; counted: number | null }[];
  };
  const saveCounts = async () => { const lines = entered(); if (lines && open) await step(() => saveCountAction(open.id, lines), 'Counts saved.'); };
  const submit = async () => {
    const lines = entered(); if (!lines || !open) return;
    if (await step(() => saveCountAction(open.id, lines), '')) await step(() => submitCountAction(open.id), 'Submitted. An Owner or Admin who did not submit it approves the differences.');
  };
  const decide = async (approve: boolean) => {
    if (!open) return;
    if (await step(() => decideCountAction(open.id, approve, note.trim()), approve ? 'Approved. The differences are posted.' : 'Rejected. Start a new count.')) { setNote(''); await load(); }
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Stock counts</h1>
    <p className="text-muted-foreground">Count what is on the shelf, and put right any difference from your books.</p></div>;
  if (counts === null) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;

  return <div className="max-w-3xl space-y-6">{heading}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {!open ? <section aria-label="Start a count" className="space-y-2 rounded-xl border p-4">
      <h2 className="font-semibold">Start a count</h2>
      <div className="space-y-1"><Label htmlFor="count-name">Name</Label><Input id="count-name" value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)} /></div>
      <Button type="button" disabled={busy || !name.trim()} onClick={() => void step(() => startCountAction(key, name.trim()), 'Count started. Enter what you find on the shelf.')}>Start count</Button>
    </section> : <section aria-label={open.name} className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">{open.name}{open.outlet ? ` · ${open.outlet}` : ''} · {STATUS[open.status]}</h2>
      {open.status === 'counting' && <p className="text-sm text-muted-foreground">Leave an item empty if you did not count it; it will not change. Sales made while you count are allowed for.</p>}
      <ul className="divide-y text-sm">{(open.lines ?? []).map(l => <li key={l.item_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span className="min-w-40 flex-1">{l.name}</span>
        <span className="text-muted-foreground">Books: {l.expected}</span>
        {open.status === 'counting'
          ? <Input aria-label={`Counted ${l.name}`} className="h-9 w-24" inputMode="numeric" value={typed[l.item_id] ?? ''} disabled={busy} onChange={e => setTyped(t => ({ ...t, [l.item_id]: e.target.value }))} />
          : <span>Counted: {l.counted ?? 'not counted'}{l.difference ? <strong className={l.difference < 0 ? ' text-destructive' : ' text-emerald-700'}> ({l.difference > 0 ? '+' : ''}{l.difference})</strong> : ''}</span>}
      </li>)}</ul>
      {open.status === 'counting' ? <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void saveCounts()}>Save</Button>
        <Button type="button" disabled={busy} onClick={() => void submit()}>Submit for approval</Button></div>
      : <div className="space-y-2"><p className="text-sm">{open.summary.differences} difference{open.summary.differences === 1 ? '' : 's'} to post.</p>
        <Input aria-label="Note" placeholder="Note (needed to reject)" value={note} maxLength={500} disabled={busy} onChange={e => setNote(e.target.value)} />
        <div className="flex gap-2"><Button type="button" disabled={busy} onClick={() => void decide(true)}>Approve and post</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void decide(false)}>Reject</Button></div></div>}
    </section>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {counts.filter(c => c.status === 'approved' || c.status === 'rejected').length > 0 && <section aria-label="Earlier counts" className="space-y-1 text-sm">
      <h2 className="font-semibold">Earlier counts</h2>
      <ul>{counts.filter(c => c.status === 'approved' || c.status === 'rejected').map(c => <li key={c.id}>{c.name} · {STATUS[c.status]}{c.decided_on ? ` on ${c.decided_on}` : ''} · {c.summary.differences} difference{c.summary.differences === 1 ? '' : 's'}{c.note ? ` · ${c.note}` : ''}</li>)}</ul>
    </section>}
  </div>;
}
