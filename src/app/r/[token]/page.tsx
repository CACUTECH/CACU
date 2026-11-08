"use client";
// A receipt link (Doc 10 E20): opens without an account and shows one sale's receipt: the business, the items, the totals
// and how it was paid. Never the customer's details. A revoked or unknown link shows nothing.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type PublicReceipt = {
  business: { name: string; address: string | null; phone: string | null };
  number: string; date: string; status: string; method: string; subtotal: number; discount_total: number; total: number;
  transfer_amount: number | null; cash_received: number | null; change: number | null; refunded_total: number | null; deposit_applied: number | null;
  items: { name: string; quantity: number; unit_price: number; discount: number; total: number }[];
};
const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', split: 'Cash and transfer', credit: 'Credit' };
const money = (value: number | string | null) => `₦${Number(value ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PublicReceiptPage() {
  const { token } = useParams<{ token: string }>();
  const [receipt, setReceipt] = React.useState<PublicReceipt | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    if (!/^[0-9a-f]{64}$/.test(token ?? '')) { setReceipt(null); return; }
    void createClient().rpc('public_receipt', { p_token: token }).then(({ data, error }) => { if (live) setReceipt(error ? null : (data as PublicReceipt | null)); },
      () => { if (live) setReceipt(null); });
    return () => { live = false; };
  }, [token]);

  if (receipt === undefined) return <main className="mx-auto max-w-sm p-6"><p role="status">Loading receipt…</p></main>;
  if (receipt === null) return <main className="mx-auto max-w-sm space-y-2 p-6"><h1 className="text-xl font-bold">Receipt not available</h1>
    <p className="text-muted-foreground">This link does not work. It may have been typed wrongly, or the business has withdrawn it. Ask the business for a new one.</p></main>;
  const paid = Number(receipt.deposit_applied ?? 0);
  return <main className="mx-auto max-w-sm p-4">
    <article aria-label="Receipt" className="space-y-3 rounded-lg border bg-white p-4 text-sm text-black">
      <header className="text-center">
        <h1 className="text-lg font-bold">{receipt.business.name}</h1>
        {receipt.business.address && <p>{receipt.business.address}</p>}
        {receipt.business.phone && <p>{receipt.business.phone}</p>}
        <p className="mt-2">Receipt {receipt.number}</p><p>{receipt.date}</p>
      </header>
      <hr className="border-dashed border-black" />
      <table className="w-full"><tbody>
        {receipt.items.map((item, i) => <tr key={`${item.name}-${i}`} className="align-top">
          <td>{item.quantity} x {item.name}{Number(item.discount) > 0 && <span className="block">less {money(item.discount)}</span>}</td>
          <td className="text-right">{money(item.total)}</td></tr>)}
      </tbody></table>
      <hr className="border-dashed border-black" />
      {Number(receipt.discount_total) > 0 && <p className="flex justify-between"><span>Discount</span><span>−{money(receipt.discount_total)}</span></p>}
      <p className="flex justify-between text-base font-bold"><span>Total</span><span>{money(receipt.total)}</span></p>
      {paid > 0 && <p className="flex justify-between"><span>Deposit paid earlier</span><span>−{money(paid)}</span></p>}
      <p className="flex justify-between"><span>Paid by</span><span>{METHOD[receipt.method] ?? receipt.method}</span></p>
      {receipt.status === 'pending_payment' && <p className="text-center font-bold">Transfer awaiting confirmation</p>}
      {receipt.status === 'reversed' && <p className="text-center font-bold">Reversed: transfer not received</p>}
      {Number(receipt.refunded_total ?? 0) > 0 && <p className="flex justify-between font-bold"><span>Refunded</span><span>−{money(receipt.refunded_total)}</span></p>}
      <p className="text-center">Thank you</p>
    </article>
    <p className="mt-3 text-center text-xs text-muted-foreground">Receipt sent by {receipt.business.name} using CACU.</p>
  </main>;
}
