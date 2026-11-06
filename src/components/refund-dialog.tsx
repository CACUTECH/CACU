"use client";
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getRefundableAction, requestRefundAction } from '@/app/pos/actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import type { CollectionAccount } from '@/lib/collection-accounts';
import { nairaText, refundKobo, refundWaits, type Refundable } from '@/lib/checkout';

type Line = { quantity: string; restock: boolean };

/** Doc 10 refunds: choose items and quantities from the sale; resaleable goods go back to stock; the money goes back by the
 * original method unless changed. Within the person's approval limit it is paid at once, otherwise it waits (FR-044). */
export function RefundDialog({ saleId, open, onClose, onDone }: { saleId: string; open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [info, setInfo] = useState<Refundable | null>(null), [banks, setBanks] = useState<CollectionAccount[]>([]);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [method, setMethod] = useState<'Cash' | 'Transfer'>('Cash'), [bank, setBank] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());  // kept across retries so a lost response never refunds twice

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(''); setInfo(null);
    void Promise.all([getRefundableAction(saleId), getCollectionAccountsAction().catch(() => ({ native: false, accounts: [] as CollectionAccount[] }))])
      .then(([result, accounts]) => {
        if (!live) return;
        setBanks(accounts.accounts);
        if (!result.success) { setError(result.error); return; }
        setInfo(result.data); setMethod(result.data.default_method);
        setLines(Object.fromEntries(result.data.lines.map(l => [l.line_id, { quantity: '0', restock: l.restockable }])));
      });
    return () => { live = false; };
  }, [open, saleId]);

  const chosen = (info?.lines ?? []).map(l => ({ line: l, quantity: Number(lines[l.line_id]?.quantity ?? 0), restock: lines[l.line_id]?.restock ?? false }));
  const badQuantity = chosen.some(c => !Number.isInteger(c.quantity) || c.quantity < 0 || c.quantity > c.line.refundable);
  const picked = chosen.filter(c => c.quantity > 0);
  const totalKobo = picked.reduce((sum, c) => sum + refundKobo(c.line, c.quantity), 0);
  const problem = !info ? '' : badQuantity ? 'Enter a whole number no more than what can still be refunded.'
    : picked.length === 0 ? 'Choose at least one item to refund.'
    : reason.trim().length < 3 ? 'Say why the sale is refunded.'
    : method === 'Transfer' && !bank && info && !refundWaits(totalKobo, info) ? 'Choose the bank account the refund is paid from.' : '';
  const waits = info ? refundWaits(totalKobo, info) : true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem || busy) return;
    setBusy(true); setError('');
    const result = await requestRefundAction(saleId, { requestKey: key.current, method, bankAccountId: method === 'Transfer' ? bank : undefined, reason: reason.trim(),
      lines: picked.map(c => ({ lineId: c.line.line_id, quantity: c.quantity, restock: c.restock })) });
    setBusy(false);
    if (!result.success) { setError(result.error); if (!result.uncertain) key.current = crypto.randomUUID(); return; }
    key.current = crypto.randomUUID();
    const amount = nairaText(totalKobo);
    onDone(result.data.status === 'posted'
      ? (method === 'Cash' ? `Refunded ${amount}. Hand it back from the till.` : `Refunded ${amount}. Send it to the customer by transfer.`)
      : `Refund of ${amount} is waiting for approval on Daily reconciliation.`);
  }

  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Refund</DialogTitle>
        <DialogDescription>{info ? `Receipt ${info.number}, ${info.date}. Paid ${nairaText(Math.round(Number(info.total) * 100))}${Number(info.refunded_total) > 0 ? `, ${nairaText(Math.round(Number(info.refunded_total) * 100))} already refunded` : ''}.` : 'Loading the sale…'}</DialogDescription>
      </DialogHeader>
      {!info && !error && <p role="status">Loading…</p>}
      {info && <form className="space-y-4" onSubmit={e => void submit(e)}>
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium">Items</legend>
          {info.lines.map(l => <div key={l.line_id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
            <span className="min-w-[8rem] flex-1">{l.name}<span className="block text-xs text-muted-foreground">
              {l.refundable === 0 ? 'Already refunded' : `${l.refundable} of ${l.quantity} can be refunded`}</span></span>
            <label className="flex items-center gap-1"><span className="sr-only">Quantity of {l.name} to refund</span>
              <Input aria-label={`Quantity of ${l.name} to refund`} inputMode="numeric" className="h-9 w-16 text-right" disabled={l.refundable === 0}
                value={lines[l.line_id]?.quantity ?? '0'} onChange={e => setLines(s => ({ ...s, [l.line_id]: { ...s[l.line_id], quantity: e.target.value } }))} /></label>
            {l.restockable && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={lines[l.line_id]?.restock ?? true}
              onChange={e => setLines(s => ({ ...s, [l.line_id]: { ...s[l.line_id], restock: e.target.checked } }))} />Back to stock</label>}
          </div>)}
        </fieldset>
        <div role="radiogroup" aria-label="Refund by" className="grid grid-cols-2 gap-2">
          {(['Cash', 'Transfer'] as const).map(m => <Button key={m} type="button" role="radio" aria-checked={method === m} disabled={busy}
            variant={method === m ? 'default' : 'outline'} onClick={() => setMethod(m)}>{m === 'Cash' ? 'Cash from the till' : 'Bank transfer'}</Button>)}
        </div>
        {method === 'Transfer' && <label className="block space-y-1 text-sm"><span>Bank account it is paid from{waits ? ' (the approver can choose)' : ''}</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={bank} disabled={busy} onChange={e => setBank(e.target.value)}>
            <option value="">Choose the bank account</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>}
        <label className="block space-y-1 text-sm"><span>Reason</span>
          <Input required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="For example: wrong size, customer returned it" /></label>
        <p className="text-sm">Refund <span className="font-semibold">{nairaText(totalKobo)}</span>.{' '}
          {picked.length > 0 && (waits ? 'It waits for an Owner, Admin or Sales manager to approve it.' : 'It is paid now.')}</p>
        {(problem || error) && <p role="alert" className="text-sm text-destructive">{error || problem}</p>}
        <Button type="submit" className="w-full" disabled={busy || !!problem}>{busy ? 'Saving…' : waits ? 'Ask for approval' : 'Refund now'}</Button>
      </form>}
      {!info && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
