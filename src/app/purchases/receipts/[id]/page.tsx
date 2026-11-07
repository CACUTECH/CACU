"use client";
// A goods receipt (Doc 10): what arrived and at what cost, any returns, and returning goods to the supplier at the cost
// they were received at. A receipt is never changed; returns correct it.
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { billReceivedAction, getReceiptAction, returnGoodsAction } from '../../actions';
import { lagosToday } from '@/lib/transfers';
import { kobo, nairaText } from '@/lib/checkout';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { naira } from '@/lib/transfers';
import type { GoodsReceipt } from '@/lib/purchasing';

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [receipt, setReceipt] = React.useState<GoodsReceipt | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [returning, setReturning] = React.useState(false), [billing, setBilling] = React.useState(false), [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    void getReceiptAction(id).then(r => { if (!live) return; if (r.success) { setReceipt(r.data); setError(''); } else setError(r.error); });
    return () => { live = false; };
  }, [id, version]);

  if (error && !receipt) return <p role="alert" className="text-destructive">{error}</p>;
  if (!receipt) return <p role="status">Loading…</p>;
  const returnable = receipt.lines.some(l => l.returnable > 0);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">{receipt.number}</h1>
        <p className="text-muted-foreground">From {receipt.supplier_name ?? 'supplier'} on {receipt.received_on}{receipt.order_number ? `, against ${receipt.order_number}` : ''}{receipt.outlet ? `, into ${receipt.outlet}` : ''}</p>
        {receipt.note && <p className="text-sm">{receipt.note}</p>}</div>
      <div className="flex flex-wrap gap-2">
        {receipt.order_id && <Button asChild variant="outline"><Link href={`/purchases/${receipt.order_id}`}>{receipt.order_number}</Link></Button>}
        <Button asChild variant="outline"><Link href="/purchases/receipts">All receipts</Link></Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Card><CardHeader><CardTitle>Received</CardTitle><CardDescription>Total {naira(receipt.total)}</CardDescription></CardHeader>
      <CardContent><table className="w-full text-left text-sm">
        <thead><tr>{['Product', 'Quantity', 'Unit cost', 'Total', 'Returned'].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
        <tbody>{receipt.lines.map(l => <tr key={l.item_id} className="border-t">
          <td className="p-1">{l.name}</td><td className="p-1">{l.quantity}</td><td className="p-1">{naira(l.unit_cost)}</td>
          <td className="p-1">{naira(l.amount)}</td><td className="p-1">{l.returned_quantity || ''}</td>
        </tr>)}</tbody>
      </table></CardContent></Card>
    {receipt.returns.length > 0 && <Card><CardHeader><CardTitle>Returned to the supplier</CardTitle></CardHeader>
      <CardContent><ul className="space-y-1 text-sm">{receipt.returns.map(r => <li key={r.id}>{r.returned_on}: {naira(r.total)}, {r.reason}</li>)}</ul></CardContent></Card>}
    <div className="flex flex-wrap gap-2">
      {returnable && <Button onClick={() => { setMessage(''); setBilling(true); }}>Enter supplier&apos;s bill</Button>}
      {returnable && <Button variant="outline" onClick={() => { setMessage(''); setReturning(true); }}>Return to supplier</Button>}
    </div>
    {receipt.lines.some(l => l.billed_quantity > 0) && <p className="text-sm text-muted-foreground">Billed: {receipt.lines.map(l => `${l.billed_quantity} of ${l.quantity} ${l.name}`).join(', ')}. Pay it from Bills.</p>}
    {billing && <BillDialog receipt={receipt} onClose={() => setBilling(false)}
      onDone={text => { setBilling(false); setMessage(text); setVersion(v => v + 1); }} />}
    {returning && <ReturnDialog receipt={receipt} onClose={() => setReturning(false)}
      onDone={(text, updated) => { setReturning(false); setReceipt(updated); setMessage(text); }} />}
  </div>;
}

function ReturnDialog({ receipt, onClose, onDone }: { receipt: GoodsReceipt; onClose: () => void; onDone: (text: string, receipt: GoodsReceipt) => void }) {
  const lines = receipt.lines.filter(l => l.returnable > 0);
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const chosen = lines.filter(l => (quantities[l.item_id] ?? '').trim() && quantities[l.item_id].trim() !== '0');
  const bad = chosen.find(l => !/^\d{1,7}$/.test(quantities[l.item_id].trim()) || Number(quantities[l.item_id]) > l.returnable);
  const totalKobo = chosen.reduce((s, l) => s + Math.round(Number(l.unit_cost) * Number(quantities[l.item_id] || 0) * 100), 0);
  const problem = bad ? `You can return at most ${bad.returnable} ${bad.name}.` : chosen.length === 0 ? 'Enter what you are sending back.'
    : reason.trim().length < 3 ? 'Say why the goods are going back.' : '';
  const submit = async () => {
    const updated = await run(key => returnGoodsAction(receipt.id, { requestKey: key, reason: reason.trim(),
      lines: chosen.map(l => ({ itemId: l.item_id, quantity: Number(quantities[l.item_id]) })) }));
    if (updated) onDone(`Returned ${naira(totalKobo / 100)} of goods. Stock and what you owe the supplier went down.`, updated);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Return to supplier</DialogTitle>
        <DialogDescription>Goods leave stock at the cost they were received at. Goods already billed are returned with a supplier credit, later.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        {lines.map(l => <label key={l.item_id} className="flex items-center justify-between gap-2"><span>{l.name} <span className="text-muted-foreground">(up to {l.returnable})</span></span>
          <Input aria-label={`Quantity of ${l.name} to return`} className="h-9 w-24" inputMode="numeric" value={quantities[l.item_id] ?? ''} disabled={locked}
            onChange={e => setQuantities(q => ({ ...q, [l.item_id]: e.target.value }))} /></label>)}
        <label className="space-y-1"><span>Reason</span><Input maxLength={500} value={reason} disabled={locked} onChange={e => setReason(e.target.value)} /></label>
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Returning…' : 'Return goods'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** The supplier's bill for this receipt (PR-18). The amount starts at the received value; a different amount (a new price,
 * a delivery charge) adjusts the cost of stock still held, and cost of sales for units already sold (IAS 2). */
function BillDialog({ receipt, onClose, onDone }: { receipt: GoodsReceipt; onClose: () => void; onDone: (text: string) => void }) {
  const lines = receipt.lines.filter(l => l.returnable > 0);
  const valueKobo = (l: GoodsReceipt['lines'][number], quantity: number) => Math.round(Number(l.unit_cost) * quantity * 100);
  const [rows, setRows] = React.useState(() => lines.map(l => ({ itemId: l.item_id, name: l.name, max: l.returnable, quantity: String(l.returnable),
    amount: (valueKobo(l, l.returnable) / 100).toFixed(2) })));
  const [number, setNumber] = React.useState(''), [date, setDate] = React.useState(lagosToday()), [due, setDue] = React.useState(''), [notes, setNotes] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const chosen = rows.filter(r => r.quantity.trim() && r.quantity.trim() !== '0');
  const bad = chosen.find(r => !/^\d{1,7}$/.test(r.quantity.trim()) || Number(r.quantity) > r.max || !/^\d{1,13}(\.\d{1,2})?$/.test(r.amount.trim()));
  const received = chosen.reduce((s, r) => s + valueKobo(lines.find(l => l.item_id === r.itemId)!, Number(r.quantity) || 0), 0);
  const billed = chosen.reduce((s, r) => s + (/^\d{1,13}(\.\d{1,2})?$/.test(r.amount.trim()) ? kobo(r.amount) : 0), 0);
  const problem = !number.trim() ? "Enter the supplier's bill number." : bad ? `Check the quantity (up to ${bad.max}) and amount for ${bad.name}.`
    : chosen.length === 0 ? 'Choose what this bill is for.' : billed <= 0 ? 'A bill must be for more than zero.'
    : due && due < date ? 'The due date cannot be before the bill date.' : '';
  const submit = async () => {
    const done = await run(key => billReceivedAction({ requestKey: key, supplierId: receipt.supplier_id, billNumber: number.trim(), entryDate: date, dueDate: due || undefined,
      notes: notes.trim(), lines: chosen.map(r => ({ receiptId: receipt.id, itemId: r.itemId, quantity: Number(r.quantity), amount: r.amount.trim() })) }));
    if (done) onDone(`Bill ${done.bill_number} for ${naira(done.total)} recorded. You owe ${receipt.supplier_name ?? 'the supplier'}; pay it from Bills.`);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Enter supplier&apos;s bill</DialogTitle>
        <DialogDescription>For goods on {receipt.number}. Change an amount if the bill differs from what the goods were received at.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1"><span>Bill number</span><Input maxLength={100} value={number} disabled={locked} onChange={e => setNumber(e.target.value)} /></label>
          <label className="space-y-1"><span>Bill date</span><Input type="date" value={date} max={lagosToday()} disabled={locked} onChange={e => e.target.value && setDate(e.target.value)} /></label>
          <label className="space-y-1"><span>Due (optional)</span><Input type="date" value={due} disabled={locked} onChange={e => setDue(e.target.value)} /></label>
        </div>
        {rows.map((r, i) => <div key={r.itemId} className="flex flex-wrap items-end gap-2">
          <span className="w-32 font-medium">{r.name}</span>
          <label className="space-y-1"><span>Quantity</span><Input aria-label={`Quantity of ${r.name} billed`} className="h-9 w-20" inputMode="numeric" value={r.quantity} disabled={locked}
            onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></label>
          <label className="space-y-1"><span>Amount (₦)</span><Input aria-label={`Amount billed for ${r.name}`} className="h-9 w-32" inputMode="decimal" value={r.amount} disabled={locked}
            onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} /></label>
        </div>)}
        <label className="space-y-1"><span>Notes (optional)</span><Input maxLength={1000} value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} /></label>
        <p>Received at {nairaText(received)}; billed {nairaText(billed)}.{billed !== received ? ` The ${nairaText(Math.abs(billed - received))} difference ${billed > received ? 'adds to' : 'comes off'} the cost of these goods.` : ''}</p>
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Recording…' : 'Record bill'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
