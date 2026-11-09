"use client";
// Use a customer's advance on one of their invoices (Doc 09 PR-11): it moves money the customer already paid from
// Customer deposits and advances to the invoice.
import * as React from 'react';
import { applyAdvanceAction, customerOpenItemsAction } from '@/app/invoices/receivables-actions';
import { fromCents, naira } from '@/lib/receivables';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Invoice = { id: string; invoice_number: string; customer_id?: string };

export function ApplyAdvanceDialog({ invoice, onClose, onSaved }: { invoice: Invoice | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [held, setHeld] = React.useState<string | null>(null), [open, setOpen] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState(''), [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  React.useEffect(() => {
    setHeld(null); setOpen(null); setAmount(''); setKey(null); setError('');
    if (!invoice?.customer_id) return;
    let live = true;
    void customerOpenItemsAction(invoice.customer_id).then(r => {
      if (!live) return;
      if (!r.success) { setError(r.error); return; }
      const owed = r.data.invoices.find(i => i.id === invoice.id)?.open ?? '0.00';
      setHeld(r.data.advance); setOpen(owed);
      setAmount(fromCents(Math.min(Math.round(Number(r.data.advance) * 100), Math.round(Number(owed) * 100))));
    });
    return () => { live = false; };
  }, [invoice]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invoice || busy) return;
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { setError('Enter an amount above zero, with at most two decimal places.'); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await applyAdvanceAction(invoice.id, requestKey, amount);
    setBusy(false);
    if (!result.success) { if (!result.uncertain) setKey(null); setError(result.error); return; }
    onSaved(`${naira(amount)} of the advance applied to ${invoice.invoice_number}. Still owed: ${naira(result.data.outstanding)}.`);
    onClose();
  }

  const nothing = held !== null && (Number(held) <= 0 || Number(open) <= 0);
  return <Dialog open={!!invoice} onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Use the customer&apos;s advance</DialogTitle>
      <DialogDescription>{invoice?.invoice_number}. Money the customer already paid in advance pays this invoice.</DialogDescription></DialogHeader>
      {!invoice?.customer_id ? <p className="text-sm">This invoice has no customer.</p> : <form onSubmit={submit} className="space-y-4">
        {held === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        {held !== null && <p className="text-sm">Advance held: <span className="font-medium">{naira(held)}</span> · Still owed on this invoice: <span className="font-medium">{naira(open ?? '0')}</span></p>}
        {nothing ? <p className="text-sm text-muted-foreground">{Number(held) <= 0 ? 'This customer holds no advance.' : 'Nothing is open on this invoice.'}</p> : held !== null && <>
          <div className="space-y-2"><Label htmlFor="advance-amount">Amount to apply (NGN)</Label>
            <Input id="advance-amount" inputMode="decimal" value={amount} disabled={busy || key !== null} onChange={e => setAmount(e.target.value)} /></div>
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>{busy ? 'Applying…' : key ? 'Retry' : 'Apply advance'}</Button></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>}
    </DialogContent>
  </Dialog>;
}
