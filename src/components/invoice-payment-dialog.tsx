"use client";
import * as React from 'react';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { markAsPaidAction } from '@/app/invoices/actions';
import type { CollectionAccounts } from '@/lib/collection-accounts';
import { CollectionAccountPicker } from '@/components/collection-account-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Invoice = { id: string; invoice_number: string; customer_id?: string; total: number; outstanding?: string };
type Draft = { invoiceId: string; requestKey: string; amount: string; method: 'Cash' | 'Transfer'; bankAccountId: string; retryOnly?: boolean; choices?: CollectionAccounts };

export function InvoicePaymentDialog({ invoice, onClose, onSaved }: { invoice: Invoice | null; onClose: () => void; onSaved: () => void }) {
  const drafts = React.useRef(new Map<string, Draft>());
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [choices, setChoices] = React.useState<CollectionAccounts | null>(null);
  const [error, setError] = React.useState('');
  const [processing, setProcessing] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setChoices(null); setError('');
    if (invoice) {
      const saved = drafts.current.get(invoice.id);
      setDraft(saved || { invoiceId: invoice.id, requestKey: crypto.randomUUID(), amount: invoice.outstanding ?? String(invoice.total), method: 'Cash', bankAccountId: '' });
      if (saved?.retryOnly && saved.choices) { setChoices(saved.choices); return () => { cancelled = true; }; }
      getCollectionAccountsAction().then(result => { if (!cancelled) setChoices(result); })
        .catch(() => { if (!cancelled) setError('Payment accounts unavailable. Close and reopen to retry.'); });
    }
    return () => { cancelled = true; };
  }, [invoice]);
  const currentDraft = draft?.invoiceId === invoice?.id ? draft : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invoice || !draft || draft.invoiceId !== invoice.id || !choices || processing) return;
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(draft.amount) || Number(draft.amount) <= 0) { setError('Enter a positive amount with at most two decimal places.'); return; }
    if (!draft.retryOnly && choices.native && draft.method === 'Transfer' && !choices.accounts.some(account => account.id === draft.bankAccountId)) { setError('Select an available receiving bank account.'); return; }
    setProcessing(true); setError('');
    const attempted = { ...draft, retryOnly: true, choices };
    drafts.current.set(invoice.id, attempted);
    setDraft(attempted);
    try {
      const result = await markAsPaidAction({ invoiceId: invoice.id, customerId: invoice.customer_id, requestKey: draft.requestKey,
        amount: draft.amount, method: draft.method, bankAccountId: choices.native && draft.method === 'Transfer' ? draft.bankAccountId : undefined });
      if (!result.success) {
        if (result.retryable === false && !draft.retryOnly) { drafts.current.delete(invoice.id); setDraft({ ...draft, retryOnly: false }); }
        setError(result.error || 'Payment failed. Retry using the same payment details.'); return;
      }
      drafts.current.delete(invoice.id); onSaved(); onClose();
    } catch { setError('Payment response unavailable. Retry using the same payment details.'); }
    finally { setProcessing(false); }
  }
  return <Dialog open={!!invoice} onOpenChange={open => { if (!open && !processing) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Record invoice payment</DialogTitle>
      <DialogDescription>{invoice?.invoice_number}. Outstanding: NGN {invoice?.outstanding ?? invoice?.total}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <Label htmlFor="receipt-amount">Amount received (NGN)</Label>
        <Input id="receipt-amount" inputMode="decimal" required disabled={processing || !choices || !currentDraft || currentDraft.retryOnly} value={currentDraft?.amount || ''} onChange={event => setDraft(previous => previous && { ...previous, amount: event.target.value })} />
        {choices && currentDraft ? <CollectionAccountPicker method={currentDraft.method} bankAccountId={currentDraft.bankAccountId} choices={choices} disabled={processing || currentDraft.retryOnly}
          onMethodChange={method => setDraft({ ...currentDraft, method })} onBankChange={bankAccountId => setDraft({ ...currentDraft, bankAccountId })} /> : !error ? <p role="status">Loading payment accounts...</p> : null}
        {currentDraft?.retryOnly && <p role="status" className="text-sm text-muted-foreground">Retry the original payment details to confirm whether it was recorded.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full min-h-11" disabled={processing || !choices || !currentDraft || (choices.native && currentDraft.method === 'Transfer' && !currentDraft.bankAccountId)}>{processing ? 'Recording payment...' : currentDraft?.retryOnly ? 'Retry payment' : 'Record payment'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
