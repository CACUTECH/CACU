"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ActionResult, PostedEntry, ReversalInput } from '@/lib/corrections';

const today = () => new Date().toLocaleDateString('en-CA');
const naira = (amount: string) => `NGN ${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

/** Posted entries, newest first. A wrong entry is never edited: an Owner or Admin posts its mirror image (PR-26). */
export function PostedEntries({ title, entries, canReverse, empty, onReverse, onReversed }: {
  title: string; entries: PostedEntry[]; canReverse: boolean; empty: string;
  onReverse: (id: string, input: ReversalInput) => Promise<ActionResult<unknown>>; onReversed: () => void;
}) {
  const [target, setTarget] = useState<PostedEntry | null>(null), [reason, setReason] = useState(''), [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [key, setKey] = useState<string | null>(null);
  function open(entry: PostedEntry) { setTarget(entry); setReason(''); setDate(today()); setError(''); setKey(null); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || !reason.trim()) return;
    // Keep the key while the outcome is unknown so a retry cannot post a second reversal.
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await onReverse(target.id, { request_key: requestKey, entry_date: date, reason: reason.trim() });
    setBusy(false);
    if (result.success) { setTarget(null); onReversed(); return; }
    if (!result.uncertain) setKey(null);
    setError(result.error);
  }
  return <section aria-label={title} className="space-y-3">
    <h2 className="text-lg font-semibold">{title}</h2>
    {!entries.length ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{['Date', 'Number', 'Description', 'Amount', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id} className="border-t">
        <td className="p-2">{entry.date}</td><td className="p-2">{entry.number}</td><td className="p-2">{entry.description}</td><td className="p-2">{naira(entry.amount)}</td>
        <td className="p-2">{entry.reversed ? <span className="text-muted-foreground">Reversed</span> : canReverse && <Button size="sm" variant="outline" onClick={() => open(entry)}>Reverse</Button>}</td>
      </tr>)}</tbody></table></div>}
    <Dialog open={target !== null} onOpenChange={value => { if (!value && !busy) setTarget(null); }}><DialogContent>
      <DialogHeader><DialogTitle>Reverse {target?.number}</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">This posts an equal and opposite entry for {target && naira(target.amount)}. The original stays in your books and both are shown.</p>
        <label className="block space-y-1 text-sm"><span>Reason</span><Input value={reason} required maxLength={500} disabled={busy || key !== null} onChange={e => setReason(e.target.value)}/></label>
        <label className="block space-y-1 text-sm"><span>Reversal date</span><Input type="date" value={date} min={target?.date} max={today()} required disabled={busy || key !== null} onChange={e => setDate(e.target.value)}/></label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !reason.trim()}>{busy ? 'Reversing...' : key ? 'Retry reversal' : 'Post reversal'}</Button>
      </form>
    </DialogContent></Dialog>
  </section>;
}
