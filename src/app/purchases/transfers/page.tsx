"use client";
// Transfers between outlets (purchasing part 4b): goods are sent from one outlet and are in transit until the other outlet
// confirms what arrived. Sending keeps its request key across an uncertain retry, so goods are never sent twice.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listOutletsAction, listTransfersAction, outletStockAction, sendStockAction } from '../actions';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import type { OutletStock, Transfer } from '@/lib/purchasing';

const QUANTITY = /^\d{1,7}$/;

function SendStockDialog({ stock, own, onClose, onDone }: { stock: OutletStock; own: string | null; onClose: () => void; onDone: (t: Transfer) => void }) {
  const open = stock.outlets.filter(o => o.is_active);
  const [from, setFrom] = React.useState(own ?? ''), [to, setTo] = React.useState('');
  const [rows, setRows] = React.useState<{ itemId: string; quantity: string }[]>([]), [adding, setAdding] = React.useState(''), [note, setNote] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const held = (itemId: string) => stock.items.find(i => i.id === itemId)?.outlets[from] ?? 0;
  const name = (itemId: string) => stock.items.find(i => i.id === itemId)?.name ?? 'Product';
  const fromName = stock.outlets.find(o => o.id === from)?.name ?? 'that outlet';
  const bad = rows.find(r => !QUANTITY.test(r.quantity.trim()) || Number(r.quantity) <= 0 || Number(r.quantity) > held(r.itemId));
  const problem = !from ? 'Choose the outlet sending the goods.' : !to ? 'Choose the outlet receiving them.' : from === to ? 'Send the goods to a different outlet.'
    : rows.length === 0 ? 'Add what you are sending.' : bad ? `Send between 1 and ${held(bad.itemId)} ${name(bad.itemId)} from ${fromName}.` : '';
  const submit = async () => {
    const done = await run(key => sendStockAction({ requestKey: key, fromLocation: from, toLocation: to, note: note.trim(),
      lines: rows.map(r => ({ itemId: r.itemId, quantity: Number(r.quantity) })) }));
    if (done) onDone(done);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Send stock</DialogTitle>
        <DialogDescription>The goods leave the sending outlet now and show as in transit until the other outlet confirms what arrived.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span>From</span>
            <select className="h-11 w-full rounded-md border bg-background px-3" value={from} disabled={locked || !!own} onChange={e => { setFrom(e.target.value); setRows([]); }}>
              <option value="">Choose an outlet</option>
              {stock.outlets.map(o => <option key={o.id} value={o.id}>{o.name}{o.is_active ? '' : ' (closed)'}</option>)}
            </select></label>
          <label className="space-y-1"><span>To</span>
            <select className="h-11 w-full rounded-md border bg-background px-3" value={to} disabled={locked} onChange={e => setTo(e.target.value)}>
              <option value="">Choose an outlet</option>
              {open.filter(o => o.id !== from).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
        </div>
        {rows.map((r, i) => <div key={r.itemId} className="flex items-end gap-2">
          <span className="w-40 font-medium">{name(r.itemId)}<span className="block font-normal text-muted-foreground">{held(r.itemId)} at {fromName}</span></span>
          <label className="space-y-1"><span>Quantity</span><Input aria-label={`Quantity of ${name(r.itemId)} to send`} className="h-9 w-24" inputMode="numeric" value={r.quantity}
            disabled={locked} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></label>
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>Remove</Button>
        </div>)}
        {from && <label className="space-y-1"><span>Add a product</span>
          <select className="h-10 w-full rounded-md border bg-background px-3" value={adding} disabled={locked}
            onChange={e => { if (e.target.value) setRows(rs => [...rs, { itemId: e.target.value, quantity: '1' }]); setAdding(''); }}>
            <option value="">Choose a product</option>
            {stock.items.filter(i => (i.outlets[from] ?? 0) > 0 && !rows.some(r => r.itemId === i.id)).map(i => <option key={i.id} value={i.id}>{i.name} ({i.outlets[from]})</option>)}
          </select></label>}
        <label className="space-y-1"><span>Note (optional)</span><Input maxLength={500} value={note} disabled={locked} onChange={e => setNote(e.target.value)} /></label>
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Sending…' : 'Send stock'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function TransfersPage() {
  const [transfers, setTransfers] = React.useState<Transfer[] | null | undefined>(undefined);
  const [stock, setStock] = React.useState<OutletStock | null>(null), [own, setOwn] = React.useState<string | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [sending, setSending] = React.useState(false), [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void Promise.all([listTransfersAction(), outletStockAction(), listOutletsAction()]).then(([list, held, places]) => {
      if (!live) return;
      if (!list.success) { setError(list.error); return; }
      setTransfers(list.data);
      if (held.success) setStock(held.data);
      if (places.success) setOwn(places.data.own);
    });
    return () => { live = false; };
  }, [version]);

  const heading = <div><h1 className="font-headline text-3xl font-bold">Transfers</h1>
    <p className="text-muted-foreground">Goods moved between your outlets. They are in transit until the receiving outlet confirms what arrived.</p></div>;
  if (error) return <div className="space-y-4">{heading}<p role="alert" className="text-destructive">{error}</p></div>;
  if (transfers === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (transfers === null) return <div className="space-y-4">{heading}<p>Turn on your books to move stock between outlets.</p></div>;
  const canSend = !!stock && stock.outlets.filter(o => o.is_active).length > 1;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">{heading}
      <div className="flex gap-2">
        <Button asChild variant="outline"><Link href="/purchases/stock">Stock by outlet</Link></Button>
        <Button disabled={!canSend} onClick={() => { setMessage(''); setSending(true); }}>Send stock</Button>
      </div></div>
    {!canSend && <p className="text-sm text-muted-foreground">You need two open outlets to move stock. Add outlets in <Link className="underline" href="/settings/users">Users</Link>.</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {transfers.length === 0 ? <p>No transfers yet.</p> : <ul className="divide-y rounded-xl border">
      {transfers.map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><Link className="font-semibold underline" href={`/purchases/transfers/${t.id}`}>{t.number}</Link> {t.from_name} to {t.to_name}
          <span className="block text-muted-foreground">Sent {t.sent_on}{t.items ? `, ${t.items} product${t.items === 1 ? '' : 's'}` : ''}{t.note ? `, ${t.note}` : ''}</span></span>
        <span className={t.status === 'in_transit' ? 'font-medium text-amber-700' : ''}>{t.status === 'in_transit' ? 'In transit' : `Received ${t.received_on}`}</span>
      </li>)}
    </ul>}
    {sending && stock && <SendStockDialog stock={stock} own={own} onClose={() => setSending(false)}
      onDone={t => { setSending(false); setMessage(`${t.number} sent to ${t.to_name}. It shows as in transit until they confirm what arrived.`); setVersion(v => v + 1); }} />}
  </div>;
}
