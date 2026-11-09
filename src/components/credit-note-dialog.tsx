"use client";
// Credit note on an invoice (Doc 10 E12, Doc 09 PR-16): give units back from a line, or take an amount off it. An Owner
// or Admin posts it at once within the owner's refund limit; otherwise it waits for one. What the invoice no longer owes
// is kept as the customer's advance.
import * as React from 'react';
import { creditableAction, requestCreditNoteAction } from '@/app/invoices/credit-note-actions';
import { lineCredit, naira, type Creditable } from '@/lib/credit-notes';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Invoice = { id: string; invoice_number: string };
type Entry = { units: string; off: string; restock: boolean };

export function CreditNoteDialog({ invoice, onClose, onSaved }: { invoice: Invoice | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [info, setInfo] = React.useState<Creditable | null>(null);
  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [reason, setReason] = React.useState(''), [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  React.useEffect(() => {
    setInfo(null); setEntries({}); setReason(''); setKey(null); setError('');
    if (!invoice) return;
    let live = true;
    void creditableAction(invoice.id).then(r => {
      if (!live) return;
      if (!r.success) { setError(r.error); return; }
      setInfo(r.data);
      setEntries(Object.fromEntries(r.data.lines.map(l => [l.line_id, { units: '', off: '', restock: l.restockable }])));
    });
    return () => { live = false; };
  }, [invoice]);

  const set = (lineId: string, change: Partial<Entry>) => setEntries(e => ({ ...e, [lineId]: { ...e[lineId], ...change } }));
  const worked = (info?.lines ?? []).map(line => ({ line, entry: entries[line.line_id] ?? { units: '', off: '', restock: false },
    ...lineCredit(line, entries[line.line_id]?.units ?? '', entries[line.line_id]?.off ?? '') }));
  const total = worked.reduce((sum, w) => sum + Math.round(w.value * 100), 0) / 100;
  const owed = Number(info?.outstanding ?? 0), toAdvance = Math.max(total - owed, 0);
  const locked = busy || key !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invoice || !info || busy) return;
    const problem = worked.find(w => w.error)?.error;
    if (problem) { setError(problem); return; }
    if (total <= 0) { setError('Enter the units given back or an amount off at least one line.'); return; }
    if (reason.trim().length < 3) { setError('Say why the invoice is credited.'); return; }
    const lines = worked.filter(w => w.value > 0).map(w => w.entry.units.trim()
      ? { line_id: w.line.line_id, quantity: Number(w.entry.units), amount: null, restock: w.entry.restock && w.line.restockable }
      : { line_id: w.line.line_id, quantity: 0, amount: w.entry.off.trim(), restock: false });
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await requestCreditNoteAction({ request_key: requestKey, invoice_id: invoice.id, reason: reason.trim(), lines });
    setBusy(false);
    if (!result.success) { if (!result.uncertain) setKey(null); setError(result.error); return; }
    const c = result.data;
    onSaved(c.status === 'posted'
      ? `${c.number} posted: ${naira(c.amount)} off ${c.invoice_number}${Number(c.to_advance) > 0 ? `, of which ${naira(c.to_advance ?? 0)} is kept as the customer's advance` : ''}.`
      : `${c.number} for ${naira(c.amount)} is waiting for an Owner or Admin to approve it.`);
    onClose();
  }

  return <Dialog open={!!invoice} onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Credit note</DialogTitle>
      <DialogDescription>{invoice?.invoice_number}{info?.customer_name ? ` for ${info.customer_name}` : ''}. Give goods back or take an amount off. The invoice itself never changes.</DialogDescription></DialogHeader>
      {!info && !error && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
      {info && <form onSubmit={submit} className="space-y-4">
        <p className="text-sm">Invoice total {naira(info.total)} · Still owed {naira(info.outstanding)}{Number(info.credited_total) > 0 ? ` · Credited so far ${naira(info.credited_total)}` : ''}</p>
        {worked.map(({ line, entry, value }) => <fieldset key={line.line_id} className="space-y-2 rounded border p-3" disabled={locked}>
          <legend className="px-1 text-sm font-medium">{line.name}</legend>
          <p className="text-xs text-muted-foreground">{line.quantity} on the invoice, {naira(line.line_total)}. Can still credit {line.creditable_units} unit{line.creditable_units === 1 ? '' : 's'} or {naira(line.creditable_amount)}.</p>
          {Number(line.creditable_amount) <= 0 ? <p className="text-sm">Already credited in full.</p> : <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor={`units-${line.line_id}`}>Units given back</Label>
              <Input id={`units-${line.line_id}`} inputMode="numeric" value={entry.units} onChange={e => set(line.line_id, { units: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor={`off-${line.line_id}`}>Or amount off (NGN)</Label>
              <Input id={`off-${line.line_id}`} inputMode="decimal" value={entry.off} onChange={e => set(line.line_id, { off: e.target.value })} /></div>
          </div>}
          {line.restockable && entry.units.trim() !== '' && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={entry.restock} onChange={e => set(line.line_id, { restock: e.target.checked })} /> Back into stock (untick for damaged goods)</label>}
          {value > 0 && <p className="text-sm">Credit: {naira(value)}</p>}
        </fieldset>)}
        <div className="space-y-1"><Label htmlFor="credit-reason">Reason</Label>
          <Input id="credit-reason" value={reason} disabled={locked} maxLength={500} placeholder="For example: two bags were spoilt" onChange={e => setReason(e.target.value)} /></div>
        {total > 0 && <p className="text-sm font-medium">Credit note total {naira(total)}{toAdvance > 0 ? `. ${naira(toAdvance)} is more than is still owed and will be kept as the customer's advance.` : '.'}</p>}
        {!info.can_approve && <p className="text-xs text-muted-foreground">An Owner or Admin approves it before it reaches the books.</p>}
        {info.can_approve && info.refund_threshold !== null && total > Number(info.refund_threshold) &&
          <p className="text-xs text-amber-700">Above the owner&apos;s limit of {naira(info.refund_threshold)}: another Owner or Admin approves it.</p>}
        <Button type="submit" className="min-h-11 w-full" disabled={busy}>{busy ? 'Saving…' : key ? 'Retry' : info.can_approve ? 'Post credit note' : 'Ask for approval'}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>}
      {!info && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
