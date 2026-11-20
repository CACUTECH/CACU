"use client";
// Receive a payment from a customer (Doc 10 E11): one payment split across their open invoices, oldest due first unless
// changed here; anything beyond the split is kept as their advance (PR-10). A transfer waits for confirmation (BR-010).
import * as React from 'react';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { customerOpenItemsAction, recordCustomerPaymentAction } from '@/app/invoices/receivables-actions';
import type { CollectionAccounts } from '@/lib/collection-accounts';
import { fromCents, lagosToday, naira, splitOldestFirst, sumCents, type OpenItems } from '@/lib/receivables';
import { CollectionAccountPicker } from '@/components/collection-account-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Customer = { id: string; name: string };
const MONEY = /^\d{1,13}(\.\d{1,2})?$/;

export function CustomerPaymentDialog({ open, customers, customerId, onClose, onSaved }: { open: boolean; customers: Customer[]; customerId?: string | null;
  onClose: () => void; onSaved: (message: string) => void }) {
  const [customer, setCustomer] = React.useState(''), [items, setItems] = React.useState<OpenItems | null>(null);
  const [amount, setAmount] = React.useState(''), [parts, setParts] = React.useState<Record<string, string>>({}), [manual, setManual] = React.useState(false);
  const [method, setMethod] = React.useState<'Cash' | 'Transfer'>('Cash'), [bank, setBank] = React.useState('');
  const [choices, setChoices] = React.useState<CollectionAccounts | null>(null);
  const [key, setKey] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setCustomer(customerId ?? ''); setAmount(''); setParts({}); setManual(false); setMethod('Cash'); setBank(''); setKey(null); setError('');
    let live = true;
    void getCollectionAccountsAction().then(r => { if (live) setChoices(r); }).catch(() => { if (live) setError('Payment accounts unavailable. Close and reopen to retry.'); });
    return () => { live = false; };
  }, [open, customerId]);

  React.useEffect(() => {
    setItems(null);
    if (!open || !customer) return;
    let live = true;
    void customerOpenItemsAction(customer).then(r => { if (!live) return; if (r.success) setItems(r.data); else setError(r.error); });
    return () => { live = false; };
  }, [open, customer]);

  const locked = key !== null;
  const changeAmount = (value: string) => { setAmount(value); if (!manual && items) setParts(splitOldestFirst(value, items.invoices)); };
  const allocated = sumCents(Object.values(parts)), paid = MONEY.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const advance = paid - allocated;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!items || busy) return;
    if (!MONEY.test(amount) || paid <= 0) { setError('Enter the amount received, with at most two decimal places.'); return; }
    if (Object.values(parts).some(p => p !== '' && !MONEY.test(p))) { setError('Each invoice part is an amount with at most two decimal places.'); return; }
    const over = items.invoices.find(i => parts[i.id] && Math.round(Number(parts[i.id]) * 100) > Math.round(Number(i.open) * 100));
    if (over) { setError(`${over.invoice_number}: at most ${naira(over.open)} is still owed.`); return; }
    if (advance < 0) { setError('The invoice parts add up to more than the payment.'); return; }
    if (method === 'Transfer' && choices?.native && !bank) { setError('Choose the bank account the transfer went to.'); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await recordCustomerPaymentAction({ request_key: requestKey, customer_id: items.customer.id, amount, entry_date: lagosToday(), method,
      bank_account_id: method === 'Transfer' && bank ? bank : null,
      allocations: items.invoices.filter(i => Number(parts[i.id] || 0) > 0).map(i => ({ invoice_id: i.id, amount: parts[i.id] })) });
    setBusy(false);
    if (!result.success) { if (!result.uncertain) setKey(null); setError(result.error); return; }
    const kept = Number(result.data.advance) > 0 ? ` ${naira(result.data.advance)} kept as ${items.customer.name}'s advance.` : '';
    onSaved(result.data.status === 'awaiting_confirmation'
      ? `Transfer of ${naira(result.data.amount)} recorded. The invoices are cleared once it is confirmed on Daily reconciliation.${kept}`
      : `Payment of ${naira(result.data.amount)} recorded.${kept}`);
    onClose();
  }

  return <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Receive a payment</DialogTitle>
        <DialogDescription>One payment can clear several invoices. It is split oldest first; change the split if the customer asked.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="payment-customer">Customer</Label>
          <select id="payment-customer" className="h-11 w-full rounded-md border bg-background px-3" value={customer} disabled={busy || locked}
            onChange={e => { setCustomer(e.target.value); setAmount(''); setParts({}); setManual(false); setError(''); }}>
            <option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        {customer && !items && !error && <p role="status" className="text-sm text-muted-foreground">Loading open invoices…</p>}
        {items && <>
          <p className="text-sm">Owed: <span className="font-medium">{naira(items.open_total)}</span>
            {Number(items.advance) > 0 && <> · Advance held: <span className="font-medium">{naira(items.advance)}</span></>}</p>
          <div className="space-y-2"><Label htmlFor="payment-amount">Amount received (NGN)</Label>
            <Input id="payment-amount" inputMode="decimal" value={amount} disabled={busy || locked} onChange={e => changeAmount(e.target.value)} /></div>
          {items.invoices.length === 0 ? <p className="text-sm text-muted-foreground">No open invoices. The whole payment is kept as an advance.</p>
            : <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Invoice</th><th>Due</th><th className="text-right">Open</th><th className="text-right">Pay</th></tr></thead>
              <tbody>{items.invoices.map(i => <tr key={i.id} className="border-t">
                <td className="py-1">{i.invoice_number}{Number(i.waiting) > 0 && <span className="block text-xs text-amber-700">{naira(i.waiting)} waiting for confirmation</span>}</td>
                <td>{i.due_date ?? i.issue_date ?? ''}</td><td className="text-right">{naira(i.open)}</td>
                <td className="py-1 text-right"><Input aria-label={`Pay on ${i.invoice_number}`} className="ml-auto h-9 w-32 text-right" inputMode="decimal" value={parts[i.id] ?? ''}
                  disabled={busy || locked || Number(i.open) <= 0} onChange={e => { setManual(true); setParts(p => ({ ...p, [i.id]: e.target.value })); }} /></td>
              </tr>)}</tbody></table>}
          {manual && <Button type="button" size="sm" variant="ghost" disabled={busy || locked} onClick={() => { setManual(false); setParts(splitOldestFirst(amount, items.invoices)); }}>Split oldest first again</Button>}
          <p role="status" className="text-sm">On invoices: {naira(fromCents(allocated))}{advance > 0 && <> · Kept as advance: <span className="font-medium">{naira(fromCents(advance))}</span></>}</p>
          {choices ? <CollectionAccountPicker method={method} bankAccountId={bank} choices={choices} disabled={busy || locked} onMethodChange={setMethod} onBankChange={setBank} />
            : !error && <p role="status">Loading payment accounts…</p>}
          {method === 'Transfer' && <p className="text-sm text-muted-foreground">A transfer waits on Daily reconciliation until someone confirms the money arrived.</p>}
        </>}
        {locked && !busy && error && <p role="status" className="text-sm text-muted-foreground">Retry with the same details to check whether it was recorded.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="min-h-11 w-full" disabled={busy || !items || !choices}>{busy ? 'Recording…' : locked ? 'Retry payment' : 'Record payment'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
