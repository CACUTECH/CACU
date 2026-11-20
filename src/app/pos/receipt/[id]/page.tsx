"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/components/business-provider';
import { getReceiptAction } from '@/app/pos/actions';
import { receiptText, type SaleReceipt } from '@/lib/checkout';
import { RefundDialog } from '@/components/refund-dialog';
import { ShareReceiptDialog } from '@/components/share-receipt-dialog';

const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', split: 'Cash and transfer' };
const money = (value: string) => `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Doc 10 receipt: printable at 58 or 80 mm, and shareable on WhatsApp. */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { business } = useBusiness();
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null), [error, setError] = useState('');
  const [width, setWidth] = useState<'58mm' | '80mm'>('80mm');
  const [sharing, setSharing] = useState(false), [refunding, setRefunding] = useState(false), [message, setMessage] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void getReceiptAction(id).then(result => { if (!live) return; if (result.success) setReceipt(result.data); else setError(result.error); });
    return () => { live = false; };
  }, [id, version]);
  const name = business?.name || 'Receipt';
  if (error) return <p role="alert">{error}</p>;
  if (!receipt) return <p role="status">Loading receipt…</p>;
  const share = `https://wa.me/?text=${encodeURIComponent(receiptText(receipt, name))}`;
  return <div className="space-y-4">
    <style>{`@media print { @page { size: ${width} auto; margin: 2mm; } body * { visibility: hidden; } #receipt, #receipt * { visibility: visible; } #receipt { position: absolute; left: 0; top: 0; width: ${width}; } }`}</style>
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button asChild variant="outline"><Link href="/pos">Back to till</Link></Button>
      <Button asChild variant="outline"><Link href="/pos/sales">Sales</Link></Button>
      <div role="radiogroup" aria-label="Paper width" className="inline-flex rounded-md border p-1">
        {(['58mm', '80mm'] as const).map(w => <Button key={w} type="button" size="sm" role="radio" aria-checked={width === w} variant={width === w ? 'default' : 'ghost'} onClick={() => setWidth(w)}>{w}</Button>)}
      </div>
      <Button onClick={() => window.print()}>Print</Button>
      <Button asChild variant="outline"><a href={share} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></Button>
      {business?.id && <Button variant="outline" onClick={() => setSharing(true)}>Send to customer</Button>}
      {['completed', 'refunded'].includes(receipt.status) && Number(receipt.refunded_total ?? 0) < Number(receipt.total) &&
        <Button variant="outline" onClick={() => { setMessage(''); setRefunding(true); }}>Refund</Button>}
    </div>
    {message && <p role="status" className="print:hidden">{message}</p>}
    {business?.id && <ShareReceiptDialog businessId={business.id} saleId={id} open={sharing} onClose={() => setSharing(false)} />}
    <RefundDialog saleId={id} open={refunding} onClose={() => setRefunding(false)}
      onDone={text => { setRefunding(false); setMessage(text); setVersion(v => v + 1); }} />
    <article id="receipt" aria-label="Receipt" className="mx-auto space-y-2 rounded border bg-white p-3 font-mono text-xs text-black" style={{ width: width === '58mm' ? '58mm' : '80mm' }}>
      <header className="text-center"><p className="text-sm font-bold">{name}</p><p>Receipt {receipt.number}</p><p>{receipt.date}</p></header>
      <hr className="border-dashed border-black" />
      <table className="w-full"><tbody>
        {receipt.items.map(item => <tr key={item.name} className="align-top">
          <td>{item.quantity} x {item.name}{Number(item.discount) > 0 && <span className="block">less {money(item.discount)}</span>}</td>
          <td className="text-right">{money(item.total)}</td>
        </tr>)}
      </tbody></table>
      <hr className="border-dashed border-black" />
      {Number(receipt.discount_total) > 0 && <p className="flex justify-between"><span>Discount</span><span>−{money(receipt.discount_total)}</span></p>}
      <p className="flex justify-between text-sm font-bold"><span>Total</span><span>{money(receipt.total)}</span></p>
      {Number(receipt.deposit_applied ?? 0) > 0 && <>
        <p className="flex justify-between"><span>Deposit paid earlier</span><span>−{money(receipt.deposit_applied as string)}</span></p>
        <p className="flex justify-between font-bold"><span>Paid now</span><span>{money(receipt.paid_now as string)}</span></p>
      </>}
      <p className="flex justify-between"><span>Paid by</span><span>{METHOD[receipt.method] ?? receipt.method}</span></p>
      {receipt.transfer_amount && receipt.method === 'split' && <p className="flex justify-between"><span>Transfer</span><span>{money(receipt.transfer_amount)}</span></p>}
      {receipt.cash_received && <p className="flex justify-between"><span>Cash received</span><span>{money(receipt.cash_received)}</span></p>}
      {receipt.change && Number(receipt.change) > 0 && <p className="flex justify-between"><span>Change</span><span>{money(receipt.change)}</span></p>}
      {receipt.status === 'pending_payment' && <p className="text-center font-bold">Transfer awaiting confirmation</p>}
      {receipt.status === 'reversed' && <p className="text-center font-bold">Reversed: transfer not received</p>}
      {Number(receipt.refunded_total ?? 0) > 0 && <p className="flex justify-between font-bold"><span>Refunded</span><span>−{money(receipt.refunded_total as string)}</span></p>}
      <p className="text-center">Thank you</p>
    </article>
  </div>;
}
