"use client";
// Receiving goods (Doc 10 purchase-to-payment, PR-18): quantities and actual costs, against an order or on their own. The
// request keeps its key across an uncertain retry, so a delivery is never received twice.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { receiveGoodsAction } from '@/app/purchases/actions';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { nairaText } from '@/lib/checkout';
import type { GoodsReceipt, Supplier } from '@/lib/purchasing';

export type ReceivableLine = { itemId: string; name: string; remaining: number; unitCost: string };
type Row = { itemId: string; name: string; quantity: string; unitCost: string; remaining?: number };

const QUANTITY = /^\d{1,7}$/, COST = /^\d{1,13}(\.\d{1,4})?$/;

/** Against an order: `orderId` and its lines still to come. On their own: `suppliers` and the products that can be received. */
export function ReceiveGoodsDialog({ orderId, lines, suppliers, products, onClose, onDone }: {
  orderId?: string; lines?: ReceivableLine[]; suppliers?: Supplier[]; products?: { id: string; name: string; cost_price: number | string | null }[];
  onClose: () => void; onDone: (receipt: GoodsReceipt) => void;
}) {
  const [rows, setRows] = React.useState<Row[]>(() => (lines ?? []).filter(l => l.remaining > 0)
    .map(l => ({ itemId: l.itemId, name: l.name, quantity: String(l.remaining), unitCost: l.unitCost, remaining: l.remaining })));
  const [supplierId, setSupplierId] = React.useState(suppliers?.length === 1 ? suppliers[0].id : '');
  const [adding, setAdding] = React.useState('');
  const [note, setNote] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const set = (i: number, patch: Partial<Row>) => setRows(r => r.map((row, j) => j === i ? { ...row, ...patch } : row));
  const chosen = rows.filter(r => r.quantity.trim() !== '' && r.quantity.trim() !== '0');
  const bad = rows.find(r => r.quantity.trim() && (!QUANTITY.test(r.quantity.trim()) || (r.remaining !== undefined && Number(r.quantity) > r.remaining) || !COST.test(r.unitCost.trim())));
  const totalKobo = chosen.reduce((s, r) => s + (QUANTITY.test(r.quantity) && COST.test(r.unitCost) ? Math.round(Number(r.unitCost) * Number(r.quantity) * 100) : 0), 0);
  const problem = !orderId && !supplierId ? 'Choose the supplier the goods came from.'
    : bad ? (bad.remaining !== undefined && Number(bad.quantity) > bad.remaining ? `Only ${bad.remaining} ${bad.name} are still to come on this order.` : `Check the quantity and cost for ${bad.name}.`)
    : chosen.length === 0 ? 'Enter what arrived.' : totalKobo <= 0 ? 'The goods must be worth more than zero.' : '';
  const submit = async () => {
    const receipt = await run(key => receiveGoodsAction({ requestKey: key, orderId, supplierId: orderId ? undefined : supplierId, note: note.trim(),
      lines: chosen.map(r => ({ itemId: r.itemId, quantity: Number(r.quantity), unitCost: r.unitCost.trim() })) }));
    if (receipt) onDone(receipt);
  };
  const addProduct = (id: string) => {
    const product = products?.find(p => p.id === id);
    if (product) setRows(r => [...r, { itemId: product.id, name: product.name, quantity: '1', unitCost: product.cost_price != null ? String(Number(product.cost_price)) : '' }]);
    setAdding('');
  };

  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Receive goods</DialogTitle>
        <DialogDescription>Enter what arrived and what each unit actually cost. Stock goes up now; you owe the supplier until their bill is entered.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        {!orderId && <label className="space-y-1"><span>Supplier</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={supplierId} disabled={locked} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Choose a supplier</option>
            {(suppliers ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>}
        {rows.length === 0 && orderId && <p>Everything on this order has been received.</p>}
        {rows.map((row, i) => <div key={row.itemId} className="flex flex-wrap items-end gap-2">
          <span className="w-40 font-medium">{row.name}{row.remaining !== undefined ? <span className="block font-normal text-muted-foreground">{row.remaining} to come</span> : null}</span>
          <label className="space-y-1"><span>Quantity</span><Input aria-label={`Quantity of ${row.name} received`} className="h-9 w-24" inputMode="numeric" value={row.quantity} disabled={locked}
            onChange={e => set(i, { quantity: e.target.value })} /></label>
          <label className="space-y-1"><span>Unit cost (₦)</span><Input aria-label={`Unit cost of ${row.name}`} className="h-9 w-28" inputMode="decimal" value={row.unitCost} disabled={locked}
            onChange={e => set(i, { unitCost: e.target.value })} /></label>
        </div>)}
        {!orderId && <label className="space-y-1"><span>Add a product</span>
          <select className="h-10 w-full rounded-md border bg-background px-3" value={adding} disabled={locked} onChange={e => addProduct(e.target.value)}>
            <option value="">Choose a product</option>
            {(products ?? []).filter(p => !rows.some(r => r.itemId === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>}
        <label className="space-y-1"><span>Delivery note or reference (optional)</span><Input maxLength={500} value={note} disabled={locked} onChange={e => setNote(e.target.value)} /></label>
        <p className="font-semibold">Total: {nairaText(totalKobo)}</p>
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Receiving…' : 'Receive goods'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
