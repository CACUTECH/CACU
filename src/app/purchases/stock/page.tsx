"use client";
// Stock by outlet (purchasing part 4a): what each outlet holds of every tracked product. The total and the cost stay on the
// product; the outlets split it. Outlets are added in Users, under Branches and locations.
import * as React from 'react';
import Link from 'next/link';
import { outletStockAction } from '../actions';
import type { OutletStock } from '@/lib/purchasing';

export default function OutletStockPage() {
  const [stock, setStock] = React.useState<OutletStock | null | undefined>(undefined);
  const [error, setError] = React.useState(''), [search, setSearch] = React.useState('');

  React.useEffect(() => {
    let live = true;
    void outletStockAction().then(r => { if (!live) return; if (r.success) setStock(r.data); else setError(r.error); });
    return () => { live = false; };
  }, []);

  const heading = <div><h1 className="font-headline text-3xl font-bold">Stock by outlet</h1>
    <p className="text-muted-foreground">What each outlet holds. Goods are received into an outlet, and a till sells from its shift&apos;s outlet.</p></div>;
  if (error) return <div className="space-y-4">{heading}<p role="alert" className="text-destructive">{error}</p></div>;
  if (stock === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (stock === null) return <div className="space-y-4">{heading}<p>Turn on your books to see stock by outlet.</p></div>;
  if (stock.outlets.length === 0) return <div className="space-y-4">{heading}
    <p>Your stock is held in one place. To hold it at several outlets, add them in <Link className="underline" href="/settings/users">Users</Link>, under Branches and locations. The first outlet takes all your current stock.</p></div>;

  const transit = stock.items.some(i => i.in_transit !== 0);
  const shown = stock.items.filter(i => i.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="space-y-4">{heading}
    {stock.outlets.length > 1 && <Link className="inline-block rounded-md border px-4 py-2 text-sm font-medium" href="/purchases/transfers">Transfers between outlets</Link>}
    <input aria-label="Search products" className="h-10 w-full max-w-sm rounded-md border bg-background px-3 text-sm" placeholder="Search products"
      value={search} onChange={e => setSearch(e.target.value)} />
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b bg-muted/50">
          <th className="p-3">Product</th>
          {stock.outlets.map(o => <th key={o.id} className="p-3 text-right">{o.name}{o.is_active ? '' : ' (closed)'}</th>)}
          {transit && <th className="p-3 text-right">In transit</th>}
          <th className="p-3 text-right">Total</th>
        </tr></thead>
        <tbody>{shown.map(i => <tr key={i.id} className="border-b last:border-0">
          <td className="p-3 font-medium">{i.name}</td>
          {stock.outlets.map(o => <td key={o.id} className={`p-3 text-right ${(i.outlets[o.id] ?? 0) < 0 ? 'text-destructive' : ''}`}>{i.outlets[o.id] ?? 0}</td>)}
          {transit && <td className="p-3 text-right">{i.in_transit}</td>}
          <td className="p-3 text-right font-semibold">{i.total}</td>
        </tr>)}</tbody>
      </table>
      {shown.length === 0 && <p className="p-4">No matching products.</p>}
    </div>
  </div>;
}
