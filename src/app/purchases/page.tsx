"use client";
// Purchase orders (Doc 10 inventory purchase-to-payment), on the Oga and Chairman plans: open orders first, and a dialog
// to start one for a supplier. An order changes nothing in the books.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { ORDER_COLUMNS, ORDER_STATUS, orderError, type PurchaseOrder, type Supplier } from '@/lib/purchasing';

const FILTERS = [{ value: 'open', label: 'Open' }, { value: 'received', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }] as const;

export default function PurchasesPage() {
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [filter, setFilter] = React.useState<typeof FILTERS[number]['value']>('open');
  const [orders, setOrders] = React.useState<PurchaseOrder[] | null>(null);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [error, setError] = React.useState(''), [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const id = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(id);
        let query = supabase.from('purchase_orders').select(ORDER_COLUMNS).eq('business_id', id);
        query = filter === 'open' ? query.in('status', ['draft', 'sent', 'partly_received']) : query.eq('status', filter);
        const [plan, list, people] = await Promise.all([supabase.rpc('purchasing_allowed', { p_business_id: id }),
          query.order('created_at', { ascending: false }).limit(200),
          supabase.from('suppliers').select('id, name, phone, email').eq('business_id', id).order('name')]);
        if (!live) return;
        setAllowed(plan.error ? null : plan.data === true);
        if (list.error) { setError('Purchase orders are unavailable. You may not have access to inventory.'); return; }
        setError(''); setOrders(list.data as PurchaseOrder[]); setSuppliers((people.data as Supplier[] | null) ?? []);
      } catch { if (live) setError('Purchase orders are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, filter]);

  const names = new Map(suppliers.map(s => [s.id, s.name]));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Purchase orders</h1>
        <p className="text-muted-foreground">Order stock from your suppliers. Nothing is recorded in your books until the goods arrive.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm"><span>Show</span>
          <select className="h-10 rounded-md border bg-background px-3" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select></label>
        <Button asChild variant="outline"><Link href="/purchases/receipts">Goods received</Link></Button>
        <Button disabled={!businessId || allowed === false} onClick={() => setCreating(true)}>New order</Button>
      </div>
    </div>
    {allowed === false && <p role="status" className="rounded border p-3 text-sm">Purchase orders come with the Oga and Chairman plans. <Link className="underline" href="/settings/billing">See plans in Billing</Link>.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!orders && !error && <p role="status">Loading…</p>}
    {orders && orders.length === 0 && <p className="text-muted-foreground">No orders here yet.</p>}
    {orders && orders.length > 0 && <ul className="divide-y rounded border" aria-label="Purchase orders">
      {orders.map(o => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><Link href={`/purchases/${o.id}`} className="font-semibold underline">{o.number}</Link> {names.get(o.supplier_id) ?? 'Supplier'}
          {o.expected_date && <span className="block text-muted-foreground">Expected {o.expected_date}</span>}</span>
        <Badge variant={o.status === 'cancelled' ? 'outline' : o.status === 'received' ? 'secondary' : 'default'}>{ORDER_STATUS[o.status]}</Badge>
      </li>)}
    </ul>}
    {creating && businessId && <NewOrderDialog businessId={businessId} suppliers={suppliers} onClose={() => setCreating(false)}
      onDone={id => window.location.assign(`/purchases/${id}`)} />}
  </div>;
}

function NewOrderDialog({ businessId, suppliers, onClose, onDone }: { businessId: string; suppliers: Supplier[]; onClose: () => void; onDone: (id: string) => void }) {
  const [supabase] = React.useState(() => createClient());
  const [supplierId, setSupplierId] = React.useState(suppliers.length === 1 ? suppliers[0].id : ''), [expected, setExpected] = React.useState(''), [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const save = async () => {
    setBusy(true); setError('');
    const { data, error: failed } = await supabase.from('purchase_orders').insert({ business_id: businessId, supplier_id: supplierId,
      expected_date: expected || null, notes: notes.trim() }).select('id');
    setBusy(false);
    if (failed || !data?.length) { setError(orderError(failed)); return; }
    onDone(data[0].id);
  };
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>New purchase order</DialogTitle><DialogDescription>Add the items on the next screen.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        {suppliers.length === 0 ? <p>Add your supplier first in <Link className="underline" href="/settings/suppliers">Suppliers</Link>.</p>
          : <label className="space-y-1"><span>Supplier</span>
              <select className="h-11 w-full rounded-md border bg-background px-3" value={supplierId} disabled={busy} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Choose a supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>}
        <label className="space-y-1"><span>Deliver by (optional)</span><Input type="date" value={expected} disabled={busy} onChange={e => setExpected(e.target.value)} /></label>
        <label className="space-y-1"><span>Notes for the supplier (optional)</span><Input maxLength={1000} value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} /></label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={busy || !supplierId} onClick={() => void save()}>{busy ? 'Starting…' : 'Start order'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
