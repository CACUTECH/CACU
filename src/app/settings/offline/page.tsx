"use client";
// Settings › Offline (Doc 10 E17, Doc 13): the connection, the sales waiting on this phone, and the offline sales the
// server is holding for review. Nothing captured offline is final until CACU accepts it, and nothing is lost: a sale
// leaves this phone only once it is posted, or when someone chooses to discard it here.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBusiness } from '@/components/business-provider';
import { createClient } from '@/lib/supabase/client';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { forgetSale, type OutboxEntry } from '@/lib/offline-outbox';
import { decideOfflineSaleAction, offlineReviewAction, type ReviewSale } from '@/app/pos/offline-actions';

const STATUS: Record<string, string> = { pending: 'Waiting to send', review: 'Sent: waiting for review', failed: 'Not accepted', posted: 'Posted' };
const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
const naira = (value: string) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function ReviewItem({ sale, onDone }: { sale: ReviewSale; onDone: (text: string) => void }) {
  const canDecide = sale.can_decide;
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const decide = async (decision: 'post' | 'discard') => {
    setBusy(true); setError('');
    const result = await decideOfflineSaleAction(sale.id, decision, note.trim());
    setBusy(false);
    if (result.success) onDone(decision === 'post' ? (sale.kind === 'expense' ? 'Expense posted.' : 'Sale posted as sold.') : (sale.kind === 'expense' ? 'Expense discarded.' : 'Sale discarded.'));
    else setError(result.error);
  };
  return <li className="space-y-2 p-3 text-sm">
    <p className="font-medium">{sale.kind === 'expense' ? 'Expense' : 'Sale'}: {naira(sale.total)} by {sale.method === 'Transfer' ? 'transfer' : 'cash'}, {when(sale.sold_at)}, {sale.kind === 'expense' ? 'recorded' : 'sold'} by {sale.seller}</p>
    {sale.kind === 'expense' ? <p>{sale.description} ({sale.account}), dated {sale.entry_date}</p>
      : <p>{sale.items.map(i => `${i.quantity} x ${i.name} at ${naira(i.unit_price)}${Number(i.discount_percent) > 0 ? ` less ${i.discount_percent}%` : ''}`).join('; ')}</p>}
    <p className="text-amber-700">{sale.reason_text}{sale.detail ? `: ${sale.detail}` : ''}.</p>
    {canDecide && <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1"><span>Note</span><Input className="h-9 w-64" maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
      <Button size="sm" disabled={busy} onClick={() => void decide('post')}>{sale.kind === 'expense' ? 'Post expense' : 'Post as sold'}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (note.trim().length < 3) { setError(`Say why this ${sale.kind === 'expense' ? 'expense' : 'sale'} is discarded.`); return; } void decide('discard'); }}>Discard</Button>
    </div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </li>;
}

export default function OfflinePage() {
  const { business } = useBusiness();
  const [userId, setUserId] = React.useState<string | null>(null);
  React.useEffect(() => { void createClient().auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null)).catch(() => {}); }, []);
  const sync = useOfflineSync(business?.id ?? null, userId);
  const [review, setReview] = React.useState<{ can_decide: boolean; sales: ReviewSale[] } | null>(null);
  const [message, setMessage] = React.useState(''), [error, setError] = React.useState(''), [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!sync.connected) return;
    let live = true;
    void offlineReviewAction().then(r => { if (!live) return; if (r.success) setReview(r.data); else setError(r.error); });
    return () => { live = false; };
  }, [sync.connected, version]);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(sync.entries, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `cacu-offline-sales-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(link.href);
  };
  const discard = async (entry: OutboxEntry) => {
    if (!window.confirm('Discard this sale from this phone? It has not been recorded in CACU. Record it another way first.')) return;
    await forgetSale(entry.key); await sync.refresh(); setMessage('Removed from this phone.');
  };
  const total = (entry: OutboxEntry) => naira(entry.kind === 'expense' ? entry.payload.amount : entry.payload.quoted_total);
  const what = (entry: OutboxEntry) => entry.kind === 'expense' ? `Expense: ${entry.payload.description}`
    : entry.payload.items.map(i => `${i.quantity} x ${entry.names[i.item_id] ?? 'item'}`).join(', ');
  const at = (entry: OutboxEntry) => entry.kind === 'expense' ? entry.payload.recorded_at : entry.payload.sold_at;

  return <div className="max-w-3xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Offline sales and expenses</h1>
      <p className="text-muted-foreground">When the internet drops, the till keeps selling for cash or transfer and expenses can still be recorded. They wait on the phone that made them and are sent when it is back online. CACU checks each one before it counts.</p></div>
    <p role="status" className={sync.connected ? 'text-emerald-700' : 'font-medium text-amber-700'}>
      {sync.connected ? (sync.syncing ? 'Online. Sending…' : 'Online.') : 'Offline. Sales and expenses are kept on this phone until the connection returns.'}</p>
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}

    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">On this phone ({sync.entries.length})</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!sync.connected || sync.syncing} onClick={() => void sync.syncNow()}>Send now</Button>
          <Button size="sm" variant="outline" disabled={sync.entries.length === 0} onClick={exportAll}>Export</Button>
        </div></div>
      {sync.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting on this phone.</p>
        : <ul className="divide-y rounded-xl border text-sm">{sync.entries.map(e => <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span><span className="font-medium">{total(e)}</span> by {e.payload.method === 'Transfer' ? 'transfer' : 'cash'}, {when(at(e))}
            <span className="block text-muted-foreground">{what(e)}</span>
            {e.user_id !== userId && <span className="block text-amber-700">Made by someone else on this phone; it is sent when they sign in.</span>}
            {e.detail && <span className="block text-amber-700">{e.detail}</span>}</span>
          <span className="flex items-center gap-2"><span>{STATUS[e.status] ?? e.status}</span>
            {e.status !== 'pending' && <Button size="sm" variant="ghost" onClick={() => void discard(e)}>Discard</Button>}</span>
        </li>)}</ul>}
    </section>

    {review && <section className="space-y-2">
      <h2 className="font-semibold">Waiting for review ({review.sales.length})</h2>
      <p className="text-sm text-muted-foreground">{review.can_decide ? 'Post each one, or discard it with a reason.' : 'Someone who approves these will post them or discard them.'}</p>
      {review.sales.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p>
        : <ul className="divide-y rounded-xl border">{review.sales.map(s => <ReviewItem key={s.id} sale={s}
          onDone={text => { setMessage(text); setVersion(v => v + 1); }} />)}</ul>}
    </section>}
  </div>;
}
