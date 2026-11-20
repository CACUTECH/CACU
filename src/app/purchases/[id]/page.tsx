"use client";
// A purchase order (Doc 10): items, quantities and expected costs while it is a draft; sent to the supplier by WhatsApp,
// email or print; cancelled with a reason. Receiving the goods is part 2 and posts to the books.
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { useBusiness } from '@/components/business-provider';
import { nairaText } from '@/lib/checkout';
import { ORDER_COLUMNS, ORDER_STATUS, orderError, orderText, orderTotalKobo, whatsappNumber, type OrderLine, type PurchaseOrder, type ReceiptSummary, type Supplier } from '@/lib/purchasing';
import { listReceiptsAction } from '../actions';
import { ReceiveGoodsDialog } from '@/components/receive-goods-dialog';
import { naira } from '@/lib/transfers';

type Product = { id: string; name: string; cost_price: number | string | null; stock_quantity: number | null; item_type: string; track_stock: boolean | null };

export default function PurchaseOrderPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { business } = useBusiness();
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<PurchaseOrder | null>(null);
  const [lines, setLines] = React.useState<OrderLine[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [supplier, setSupplier] = React.useState<Supplier | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false), [version, setVersion] = React.useState(0);
  // Receipts against this order; null before the books are turned on (receiving posts to the books).
  const [receipts, setReceipts] = React.useState<ReceiptSummary[] | null>(null);
  const [receiving, setReceiving] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const owner = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(owner);
        const [found, orderLines, catalogue, received] = await Promise.all([
          supabase.from('purchase_orders').select(ORDER_COLUMNS).eq('business_id', owner).eq('id', id).limit(1),
          supabase.from('purchase_order_lines').select('id, item_id, quantity, unit_cost, received_quantity').eq('business_id', owner).eq('order_id', id).order('created_at'),
          supabase.from('catalog_items').select('id, name, cost_price, stock_quantity, item_type, track_stock').eq('business_id', owner).eq('is_active', true).order('name'),
          listReceiptsAction(id),
        ]);
        if (!live) return;
        const row = (found.data as PurchaseOrder[] | null)?.[0];
        if (found.error || !row) { setError('Order not found, or you do not have access to inventory.'); return; }
        const who = await supabase.from('suppliers').select('id, name, phone, email').eq('business_id', owner).eq('id', row.supplier_id).limit(1);
        if (!live) return;
        setOrder(row); setLines((orderLines.data as OrderLine[] | null) ?? []);
        setProducts(((catalogue.data as Product[] | null) ?? []).filter(p => p.item_type === 'PRODUCT' && p.track_stock !== false));
        setSupplier((who.data as Supplier[] | null)?.[0] ?? null);
        setReceipts(received.success ? received.data : null);
      } catch { if (live) setError('The order is unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, id, version]);

  const write = async (work: () => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>, text: string) => {
    setBusy(true); setMessage('');
    const { data, error: failed } = await work();
    setBusy(false);
    if (failed) { setError(orderError(failed)); return false; }
    if (!data?.length) { setError('You do not have permission to change purchase orders. Ask the business owner.'); return false; }
    setError(''); setMessage(text); setVersion(v => v + 1); return true;
  };

  if (error && !order) return <p role="alert" className="text-destructive">{error}</p>;
  if (!order || !businessId) return <p role="status">Loading…</p>;
  const draft = order.status === 'draft';
  const named = new Map(products.map(p => [p.id, p.name]));
  const priced = lines.map(l => ({ name: named.get(l.item_id) ?? 'Item', quantity: l.quantity, unit_cost: l.unit_cost }));
  const text = orderText(order, business?.name ?? 'Your business', supplier?.name ?? 'Supplier', priced);
  const phone = whatsappNumber(supplier?.phone);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">{order.number}</h1>
        <p className="text-muted-foreground">To {supplier?.name ?? 'supplier'}{order.expected_date ? `, deliver by ${order.expected_date}` : ''}</p>
        {order.notes && <p className="text-sm">{order.notes}</p>}</div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Badge>{ORDER_STATUS[order.status]}</Badge>
        <Button asChild variant="outline"><Link href="/purchases">All orders</Link></Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {order.cancel_reason && <p className="text-muted-foreground">Cancelled: {order.cancel_reason}</p>}

    <Card><CardHeader><CardTitle>Items</CardTitle>
      <CardDescription>{draft ? 'Expected cost per unit. You confirm the actual cost when the goods arrive.' : 'Sent orders cannot change. Cancel and make a new order instead.'}</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {lines.length === 0 ? <p className="text-muted-foreground">No items yet.</p> : <table className="w-full text-left">
          <thead><tr>{['Item', 'Quantity', 'Unit cost', 'Total', ''].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
          <tbody>{lines.map(l => <tr key={l.id} className="border-t">
            <td className="p-1">{named.get(l.item_id) ?? 'Item'}</td>
            <td className="p-1">{l.quantity}{l.received_quantity > 0 ? ` (${l.received_quantity} received)` : ''}</td>
            <td className="p-1">{nairaText(Math.round(Number(l.unit_cost) * 100))}</td>
            <td className="p-1">{nairaText(Math.round(Number(l.unit_cost) * l.quantity * 100))}</td>
            <td className="p-1 print:hidden">{draft && <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void write(() => supabase.from('purchase_order_lines').delete().eq('id', l.id).select('id'), 'Removed.')}>Remove</Button>}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t font-semibold"><td className="p-1" colSpan={3}>Total</td><td className="p-1">{nairaText(orderTotalKobo(lines))}</td><td /></tr></tfoot>
        </table>}
        {draft && <AddLine products={products.filter(p => !lines.some(l => l.item_id === p.id))} busy={busy}
          onAdd={(itemId, quantity, cost) => void write(() => supabase.from('purchase_order_lines').insert({ business_id: businessId, order_id: order.id, item_id: itemId, quantity, unit_cost: cost }).select('id'), 'Added to the order.')} />}
      </CardContent></Card>

    <div className="flex flex-wrap gap-2 print:hidden">
      {draft && <Button disabled={busy || lines.length === 0} onClick={() => void write(() => supabase.from('purchase_orders').update({ status: 'sent' }).eq('id', order.id).select('id'), 'Order marked as sent. Share it with the supplier below.')}>Mark as sent</Button>}
      {order.status !== 'draft' && order.status !== 'cancelled' && lines.length > 0 && <>
        {phone && <Button asChild variant="outline"><a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a></Button>}
        {supplier?.email && <Button asChild variant="outline"><a href={`mailto:${encodeURIComponent(supplier.email)}?subject=${encodeURIComponent(`Purchase order ${order.number}`)}&body=${encodeURIComponent(text)}`}>Email</a></Button>}
        <Button variant="outline" onClick={() => window.print()}>Print</Button>
      </>}
      {receipts && (order.status === 'sent' || order.status === 'partly_received') && <Button disabled={busy} onClick={() => { setMessage(''); setReceiving(true); }}>Receive goods</Button>}
      {(order.status === 'draft' || order.status === 'sent') && <Button variant="outline" disabled={busy} onClick={() => { setMessage(''); setCancelling(true); }}>Cancel order</Button>}
    </div>
    {order.status === 'sent' && !phone && !supplier?.email && <p className="text-sm text-muted-foreground print:hidden">Add the supplier&apos;s phone or email in Suppliers to send the order from here.</p>}

    {receipts && receipts.length > 0 && <Card><CardHeader><CardTitle>Received</CardTitle></CardHeader>
      <CardContent><ul className="space-y-1 text-sm" aria-label="Goods receipts">
        {receipts.map(r => <li key={r.id}><Link className="underline" href={`/purchases/receipts/${r.id}`}>{r.number}</Link> on {r.received_on}: {naira(r.total)}</li>)}
      </ul></CardContent></Card>}
    {receiving && <ReceiveGoodsDialog orderId={order.id} onClose={() => setReceiving(false)}
      lines={lines.map(l => ({ itemId: l.item_id, name: named.get(l.item_id) ?? 'Item', remaining: l.quantity - l.received_quantity, unitCost: String(Number(l.unit_cost)) }))}
      onDone={receipt => { setReceiving(false); setMessage(`${receipt.number} received: ${naira(receipt.total)} of stock, owed to ${supplier?.name ?? 'the supplier'} until their bill is entered.`); setError(''); setVersion(v => v + 1); }} />}
    {cancelling && <CancelOrder onClose={() => setCancelling(false)}
      onCancel={async reason => { if (await write(() => supabase.from('purchase_orders').update({ status: 'cancelled', cancel_reason: reason }).eq('id', order.id).select('id'), 'Order cancelled.')) setCancelling(false); }} />}
  </div>;
}

function AddLine({ products, busy, onAdd }: { products: Product[]; busy: boolean; onAdd: (itemId: string, quantity: number, cost: string) => void }) {
  const [itemId, setItemId] = React.useState(''), [quantity, setQuantity] = React.useState('1'), [cost, setCost] = React.useState('');
  const choose = (value: string) => { setItemId(value); const p = products.find(x => x.id === value); setCost(p?.cost_price != null ? String(Number(p.cost_price)) : ''); };
  const ok = itemId && /^\d{1,7}$/.test(quantity) && Number(quantity) > 0 && /^\d{1,13}(\.\d{1,4})?$/.test(cost);
  return <form className="flex flex-wrap items-end gap-2 print:hidden" onSubmit={e => { e.preventDefault(); if (ok) { onAdd(itemId, Number(quantity), cost); setItemId(''); setQuantity('1'); setCost(''); } }}>
    <label className="space-y-1"><span>Product</span>
      <select className="h-10 rounded-md border bg-background px-3" value={itemId} disabled={busy} onChange={e => choose(e.target.value)}>
        <option value="">Choose a product</option>
        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_quantity ?? 0} in stock)</option>)}
      </select></label>
    <label className="space-y-1"><span>Quantity</span><Input className="h-10 w-24" inputMode="numeric" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value)} /></label>
    <label className="space-y-1"><span>Unit cost (₦)</span><Input className="h-10 w-32" inputMode="decimal" value={cost} disabled={busy} onChange={e => setCost(e.target.value)} /></label>
    <Button type="submit" disabled={busy || !ok}>Add</Button>
  </form>;
}

function CancelOrder({ onClose, onCancel }: { onClose: () => void; onCancel: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState(''), [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Cancel order</DialogTitle><DialogDescription>The order stays on record as cancelled. Tell the supplier too.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm"><span>Reason</span><Input maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <DialogFooter><Button className="w-full" variant="destructive" disabled={busy || reason.trim().length < 3}
        onClick={async () => { setBusy(true); await onCancel(reason.trim()); setBusy(false); }}>{busy ? 'Cancelling…' : 'Cancel order'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
