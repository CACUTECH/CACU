"use client";
// Stock › Batches & expiry (Doc 18 R3 "E09 counts and batches", part 2). Choose which products track batches; see each
// batch left, sold earliest-expiry first; see what expires within 30 days or has expired; write an expired batch off.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { batchesAction, batchTrackingAction, writeOffBatchAction } from './actions';
import { STATE_LABEL, whenExpires, type Batch, type Batches } from '@/lib/batches';

function WriteOff({ batch, onDone }: { batch: Batch & { item: string }; onDone: (text: string) => void }) {
  const [open, setOpen] = React.useState(false), [quantity, setQuantity] = React.useState(String(batch.quantity)), [reason, setReason] = React.useState('Expired');
  const [key] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  if (!open) return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Write off</Button>;
  const go = async () => {
    if (!/^\d{1,8}$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > batch.quantity) { setError(`Enter 1 to ${batch.quantity}.`); return; }
    setBusy(true); setError('');
    const r = await writeOffBatchAction(batch.id, key, Number(quantity), reason.trim());
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    onDone(r.data.adjustment.status === 'posted' ? `${quantity} of ${batch.item} written off.` : `Write-off of ${quantity} ${batch.item} is waiting for approval.`);
  };
  return <span className="flex flex-wrap items-center gap-2">
    <Input aria-label={`Quantity of ${batch.item} to write off`} className="h-8 w-20" inputMode="numeric" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value)} />
    <Input aria-label={`Why ${batch.item} is written off`} className="h-8 w-40" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} />
    <Button type="button" size="sm" disabled={busy || reason.trim().length < 3} onClick={() => void go()}>Confirm</Button>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </span>;
}

export default function BatchesPage() {
  const [view, setView] = React.useState<Batches | null>(null), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const load = React.useCallback(async () => {
    const r = await batchesAction();
    if (r.success) { setView(r.data); setError(''); } else setError(r.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const track = async (itemId: string, on: boolean) => {
    setError(''); setMessage('');
    const r = await batchTrackingAction(itemId, on);
    if (!r.success) { setError(r.error); return; }
    setView(r.data); setMessage(on ? 'Batch tracking on. Record the batch and expiry when you next receive it.' : 'Batch tracking off.');
  };

  return <div className="max-w-4xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Batches & expiry</h1>
      <p className="text-muted-foreground">For goods with expiry dates: CACU sells the batch that expires first and warns you before stock goes off.</p></div>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!view ? <p role="status">Loading…</p> : <>
      <section aria-label="Needs attention" className="space-y-2 rounded-xl border p-4">
        <h2 className="font-semibold">Expired or expiring within {view.soon_days} days</h2>
        {view.attention.length === 0 ? <p className="text-sm text-muted-foreground">Nothing expiring soon.</p> :
          <ul className="divide-y text-sm">{view.attention.map(b => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><strong>{b.item}</strong> · batch {b.batch_no ?? 'not recorded'} · {b.quantity} left · <span className={b.state === 'expired' ? 'text-destructive' : 'text-amber-700'}>{whenExpires(b)}</span></span>
            <WriteOff batch={b} onDone={text => { setMessage(text); void load(); }} /></li>)}</ul>}
      </section>
      <section aria-label="Products" className="space-y-2">
        <h2 className="font-semibold">Products</h2>
        <ul className="divide-y rounded-xl border text-sm">{view.items.map(item => <li key={item.id} className="space-y-1 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.name} · {item.stock} in stock</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={item.tracked} onChange={e => void track(item.id, e.target.checked)} />Track batches</label></div>
          {item.tracked && (item.batches.length === 0 ? <p className="text-muted-foreground">No batches yet.</p> :
            <ul className="pl-4 text-muted-foreground">{item.batches.map(b => <li key={b.id}>{b.batch_no ?? 'No batch recorded'} · {b.quantity} · {b.expiry ? `${b.expiry} (${STATE_LABEL[b.state]})` : 'no expiry recorded'}</li>)}</ul>)}
        </li>)}</ul>
      </section>
    </>}
  </div>;
}
