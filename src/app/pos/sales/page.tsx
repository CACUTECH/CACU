"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getTillSalesAction } from '@/app/pos/actions';
import { RefundDialog } from '@/components/refund-dialog';
import { lagosToday, naira } from '@/lib/transfers';
import type { TillSale } from '@/lib/checkout';

const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', split: 'Cash + transfer' };
const STATUS: Record<string, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  completed: { label: 'Paid', variant: 'secondary' }, pending_payment: { label: 'Transfer awaiting confirmation', variant: 'outline' },
  refunded: { label: 'Refunded', variant: 'outline' }, reversed: { label: 'Reversed', variant: 'destructive' },
};

/** Doc 10: the day's till sales, to reprint a receipt or start a refund. */
export default function TillSalesPage() {
  const [day, setDay] = useState(lagosToday());
  const [sales, setSales] = useState<TillSale[] | null | undefined>(undefined), [error, setError] = useState('');
  const [refunding, setRefunding] = useState<string | null>(null), [message, setMessage] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setError(''); setSales(undefined);
    void getTillSalesAction(day).then(result => { if (!live) return; if (result.success) setSales(result.data); else setError(result.error); });
    return () => { live = false; };
  }, [day, version]);

  if (sales === null) return <div className="space-y-2"><h1 className="font-headline text-3xl font-bold">Sales and refunds</h1>
    <p role="status">Refunds are available once your books are turned on.</p></div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Sales and refunds</h1>
        <p className="text-muted-foreground">Open a receipt to print or share it, or refund items from a paid sale.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <Button asChild variant="outline"><Link href="/pos">Back to till</Link></Button>
        <label className="space-y-1 text-sm"><span>Day</span><Input type="date" value={day} max={lagosToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {sales === undefined && !error && <p role="status">Loading…</p>}
    {sales && sales.length === 0 && <p className="text-muted-foreground">No till sales on this day.</p>}
    {sales && sales.length > 0 && <div className="overflow-x-auto rounded border">
      <table className="w-full text-left text-sm">
        <thead><tr>{['Receipt', 'Paid by', 'Total', 'Status', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{sales.map(s => {
          const status = STATUS[s.status] ?? { label: s.status, variant: 'outline' as const };
          const left = Number(s.total) - Number(s.refunded_total);
          return <tr key={s.id} className="border-t">
            <td className="p-2 font-medium">{s.number}</td>
            <td className="p-2">{METHOD[s.method] ?? s.method}</td>
            <td className="p-2">{naira(s.total)}{Number(s.refunded_total) > 0 && <span className="block text-xs text-muted-foreground">{naira(s.refunded_total)} refunded</span>}</td>
            <td className="p-2"><Badge variant={status.variant}>{status.label}</Badge></td>
            <td className="p-2"><div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><Link href={`/pos/receipt/${s.id}`}>Receipt</Link></Button>
              {['completed', 'refunded'].includes(s.status) && left > 0 &&
                <Button size="sm" variant="outline" onClick={() => { setMessage(''); setRefunding(s.id); }}>Refund</Button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {refunding && <RefundDialog key={refunding} saleId={refunding} open onClose={() => setRefunding(null)}
      onDone={text => { setRefunding(null); setMessage(text); setVersion(v => v + 1); }} />}
  </div>;
}
