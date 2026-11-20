"use client";
// One transfer between outlets (purchasing part 4b). The receiving outlet confirms what arrived; anything missing is a
// loss with a reason, taken out of stock at cost. Receiving keeps its request key across an uncertain retry.
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTransferAction, receiveTransferAction } from '../../actions';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { naira } from '@/lib/transfers';
import type { Transfer } from '@/lib/purchasing';

const QUANTITY = /^\d{1,7}$/;

function ReceiveDialog({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: (t: Transfer) => void }) {
  const lines = transfer.lines ?? [];
  const [counts, setCounts] = React.useState<Record<string, string>>(() => Object.fromEntries(lines.map(l => [l.item_id, String(l.quantity)])));
  const [note, setNote] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const bad = lines.find(l => !QUANTITY.test((counts[l.item_id] ?? '').trim()) || Number(counts[l.item_id]) > l.quantity);
  const short = lines.filter(l => !bad && Number(counts[l.item_id]) < l.quantity);
  const problem = bad ? `Enter between 0 and ${bad.quantity} for ${bad.name}.` : short.length && note.trim().length < 3 ? 'Say why some goods did not arrive.' : '';
  const submit = async () => {
    const done = await run(key => receiveTransferAction(transfer.id, { requestKey: key, note: note.trim(),
      lines: lines.map(l => ({ itemId: l.item_id, receivedQuantity: Number(counts[l.item_id]) })) }));
    if (done) onDone(done);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Receive {transfer.number}</DialogTitle>
        <DialogDescription>Count what arrived at {transfer.to_name}. Anything missing comes out of stock at cost as a loss.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        {lines.map(l => <label key={l.item_id} className="flex items-center justify-between gap-2">
          <span><span className="font-medium">{l.name}</span> <span className="text-muted-foreground">({l.quantity} sent)</span></span>
          <Input aria-label={`${l.name} arrived`} className="h-9 w-24" inputMode="numeric" value={counts[l.item_id] ?? ''} disabled={locked}
            onChange={e => setCounts(c => ({ ...c, [l.item_id]: e.target.value }))} /></label>)}
        {short.length > 0 && <p className="text-amber-700">{short.map(l => `${l.quantity - Number(counts[l.item_id])} ${l.name}`).join(', ')} missing.</p>}
        <label className="space-y-1"><span>{short.length ? 'What happened' : 'Note (optional)'}</span>
          <Input maxLength={500} value={note} disabled={locked} onChange={e => setNote(e.target.value)} /></label>
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Receiving…' : 'Confirm what arrived'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function TransferPage() {
  const { id } = useParams<{ id: string }>();
  const [transfer, setTransfer] = React.useState<Transfer | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [receiving, setReceiving] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void getTransferAction(id).then(r => { if (!live) return; if (r.success) setTransfer(r.data); else setError(r.error); });
    return () => { live = false; };
  }, [id]);

  if (error) return <p role="alert" className="text-destructive">{error}</p>;
  if (!transfer) return <p role="status">Loading…</p>;
  const lost = Number(transfer.loss_value ?? 0) > 0;
  return <div className="space-y-4">
    <Link className="text-sm underline" href="/purchases/transfers">All transfers</Link>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">{transfer.number}</h1>
        <p className="text-muted-foreground">{transfer.from_name} to {transfer.to_name}, sent {transfer.sent_on}{transfer.note ? `: ${transfer.note}` : ''}</p></div>
      {transfer.status === 'in_transit' && <Button onClick={() => { setMessage(''); setReceiving(true); }}>Receive</Button>}
    </div>
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    <p className={transfer.status === 'in_transit' ? 'font-medium text-amber-700' : ''}>
      {transfer.status === 'in_transit' ? 'In transit. Stock shows at neither outlet until it is received.'
        : `Received ${transfer.received_on}${lost ? `. Lost on the way: ${naira(transfer.loss_value ?? '0')}${transfer.receive_note ? ` (${transfer.receive_note})` : ''}` : ''}.`}</p>
    <table className="w-full text-left text-sm">
      <thead><tr className="border-b"><th className="p-2">Product</th><th className="p-2 text-right">Sent</th><th className="p-2 text-right">Arrived</th><th className="p-2 text-right">Lost</th></tr></thead>
      <tbody>{(transfer.lines ?? []).map(l => <tr key={l.item_id} className="border-b last:border-0">
        <td className="p-2">{l.name}</td><td className="p-2 text-right">{l.quantity}</td>
        <td className="p-2 text-right">{l.received_quantity ?? '—'}</td><td className="p-2 text-right">{l.lost_quantity ?? '—'}</td></tr>)}</tbody>
    </table>
    {receiving && <ReceiveDialog transfer={transfer} onClose={() => setReceiving(false)}
      onDone={t => { setReceiving(false); setTransfer(t); setMessage(Number(t.loss_value ?? 0) > 0
        ? `Received. ${naira(t.loss_value ?? '0')} of goods lost on the way came out of stock.` : `Received. The goods are now at ${t.to_name}.`); }} />}
  </div>;
}
