"use client";
// Goods received (Doc 10 purchase-to-payment, PR-18): the latest receipts, and receiving a delivery that has no order.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { listReceiptsAction } from '../actions';
import { ReceiveGoodsDialog } from '@/components/receive-goods-dialog';
import { naira } from '@/lib/transfers';
import type { ReceiptSummary, Supplier } from '@/lib/purchasing';

type Product = { id: string; name: string; cost_price: number | string | null; item_type: string; track_stock: boolean | null };

export default function ReceiptsPage() {
  const [supabase] = React.useState(() => createClient());
  const [receipts, setReceipts] = React.useState<ReceiptSummary[] | null | undefined>(undefined);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]), [products, setProducts] = React.useState<Product[]>([]);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [receiving, setReceiving] = React.useState(false), [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const id = await getActiveBusinessIdAction();
        const [list, people, catalogue] = await Promise.all([listReceiptsAction(),
          supabase.from('suppliers').select('id, name, phone, email').eq('business_id', id).order('name'),
          supabase.from('catalog_items').select('id, name, cost_price, item_type, track_stock').eq('business_id', id).eq('is_active', true).order('name')]);
        if (!live) return;
        if (!list.success) { setError(list.error); return; }
        setReceipts(list.data); setSuppliers((people.data as Supplier[] | null) ?? []);
        setProducts(((catalogue.data as Product[] | null) ?? []).filter(p => p.item_type === 'PRODUCT' && p.track_stock !== false));
      } catch { if (live) setError('Goods receipts are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, version]);

  const heading = <div><h1 className="font-headline text-3xl font-bold">Goods received</h1>
    <p className="text-muted-foreground">Deliveries from suppliers. Stock goes up at the actual cost, and you owe the supplier until their bill is entered.</p></div>;
  if (receipts === null) return <div className="space-y-2">{heading}<p role="status">Receiving goods is available once your books are turned on.</p></div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">{heading}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/purchases">Purchase orders</Link></Button>
        <Button disabled={!receipts} onClick={() => { setMessage(''); setReceiving(true); }}>Receive without an order</Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {receipts === undefined && !error && <p role="status">Loading…</p>}
    {receipts && receipts.length === 0 && <p className="text-muted-foreground">Nothing received yet.</p>}
    {receipts && receipts.length > 0 && <ul className="divide-y rounded border" aria-label="Goods receipts">
      {receipts.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><Link className="font-semibold underline" href={`/purchases/receipts/${r.id}`}>{r.number}</Link> {r.supplier_name ?? 'Supplier'}
          <span className="block text-muted-foreground">{r.received_on}{r.order_number ? `, on ${r.order_number}` : ''}{r.note ? `, ${r.note}` : ''}</span></span>
        <span className="font-semibold">{naira(r.total)}</span>
      </li>)}
    </ul>}
    {receiving && <ReceiveGoodsDialog suppliers={suppliers} products={products} onClose={() => setReceiving(false)}
      onDone={receipt => { setReceiving(false); setMessage(`${receipt.number} received: ${naira(receipt.total)} of stock.`); setVersion(v => v + 1); }} />}
  </div>;
}
