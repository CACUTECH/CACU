"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { confirmTransferAction, getDailyReconciliationAction, getStockControlAction, reviewShortfallAction, saveOversellAction, transferNotReceivedAction, type Shortfall } from './actions';
import { useBusiness } from '@/components/business-provider';
import { METHOD_LABELS, lagosToday, naira, waitingFor, type DailyReconciliation, type PendingTransfer } from '@/lib/transfers';
import type { CollectionAccount } from '@/lib/collection-accounts';

type Decision = { transfer: PendingTransfer; kind: 'confirm' | 'not_received' };

/** Doc 10 daily reconciliation: the day's sales by method, and every transfer still waiting for the owner. */
export default function DailyReconciliationPage() {
  const [day, setDay] = useState(lagosToday());
  const [report, setReport] = useState<DailyReconciliation | null | undefined>(undefined);
  const [banks, setBanks] = useState<CollectionAccount[]>([]);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const load = useCallback(async () => {
    setError('');
    const [result, accounts] = await Promise.all([getDailyReconciliationAction(day), getCollectionAccountsAction().catch(() => ({ native: false, accounts: [] }))]);
    if (result.success) setReport(result.data); else { setReport(undefined); setError(result.error); }
    setBanks(accounts.accounts);
  }, [day]);
  useEffect(() => { void load(); }, [load]);

  if (report === null) return <div className="space-y-2"><h1 className="font-headline text-3xl font-bold">Daily reconciliation</h1>
    <p role="status">Daily reconciliation is available once your books are turned on. Until then, transfers are recorded as received when the sale is made.</p></div>;

  const methods = report ? Object.entries(report.by_method) : [];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Daily reconciliation</h1>
        <p className="text-muted-foreground">Check the day&apos;s sales, then confirm the transfers that arrived.</p></div>
      <label className="space-y-1 text-sm"><span>Day</span><Input type="date" value={day} max={lagosToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {report === undefined && !error && <p role="status">Loading…</p>}
    {report && <>
      <section aria-label="Sales by payment method" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {methods.length === 0 && <p className="text-sm text-muted-foreground">No sales recorded on this day.</p>}
        {methods.map(([method, totals]) => <Card key={method}>
          <CardHeader className="pb-2"><CardDescription>{METHOD_LABELS[method] ?? method}</CardDescription>
            <CardTitle className="text-2xl">{naira(totals.total)}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>{totals.sales} {totals.sales === 1 ? 'sale' : 'sales'}</p>
            {Number(totals.awaiting) > 0 && <p className="text-amber-700">{naira(totals.awaiting)} awaiting confirmation</p>}
            {Number(totals.reversed) > 0 && <p>{naira(totals.reversed)} reversed: transfer not received</p>}
          </CardContent>
        </Card>)}
      </section>
      <Card>
        <CardHeader><CardTitle>Transfers awaiting confirmation</CardTitle>
          <CardDescription>{report.pending.length === 0 ? 'Nothing is waiting.' : `${report.pending.length} waiting, ${naira(report.pending_total)} in all. Check your bank app, then confirm or mark each one.`}</CardDescription></CardHeader>
        {report.pending.length > 0 && <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{['Made', 'Waiting', 'For', 'Amount', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{report.pending.map(t => <tr key={t.id} className="border-t">
              <td className="p-2">{t.entry_date}</td>
              <td className="p-2"><Badge variant={t.age_days >= 2 ? 'destructive' : 'secondary'}>{waitingFor(t.age_days)}</Badge></td>
              <td className="p-2">{t.kind === 'sale' ? `Sale #${t.id.slice(0, 8)}` : `${t.invoice_number ?? 'Invoice'}${t.customer ? `, ${t.customer}` : ''}`}</td>
              <td className="p-2 font-medium">{naira(t.amount)}</td>
              <td className="p-2"><div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDecision({ transfer: t, kind: 'confirm' })}>Confirm</Button>
                <Button size="sm" variant="outline" onClick={() => setDecision({ transfer: t, kind: 'not_received' })}>Not received</Button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </CardContent>}
      </Card>
    </>}
    {report && <StockControl onMessage={setMessage} />}
    {decision && <DecisionDialog key={decision.transfer.id + decision.kind} decision={decision} banks={banks} onClose={() => setDecision(null)}
      onDone={text => { setDecision(null); setMessage(text); void load(); }} />}
  </div>;
}

function DecisionDialog({ decision, banks, onClose, onDone }: { decision: Decision; banks: CollectionAccount[]; onClose: () => void; onDone: (message: string) => void }) {
  const { transfer, kind } = decision;
  const key = useRef(crypto.randomUUID());  // kept across retries so a lost response never decides twice
  const [bank, setBank] = useState(transfer.expected_bank_account_id ?? (banks.length === 1 ? banks[0].id : ''));
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const result = kind === 'confirm' ? await confirmTransferAction(transfer.id, key.current, bank) : await transferNotReceivedAction(transfer.id, key.current, note.trim());
    setBusy(false);
    if (!result.success) { setError(result.error); if (!result.uncertain) key.current = crypto.randomUUID(); return; }
    onDone(kind === 'confirm' ? `${naira(transfer.amount)} confirmed and moved to the bank.`
      : transfer.kind === 'sale' ? `Marked not received. The sale was reversed and its goods returned to stock.` : 'Marked not received. The invoice is still outstanding.');
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{kind === 'confirm' ? 'Confirm transfer received' : 'Transfer not received'}</DialogTitle>
        <DialogDescription>{naira(transfer.amount)} {transfer.kind === 'sale' ? `for sale #${transfer.id.slice(0, 8)}` : `for ${transfer.invoice_number ?? 'an invoice'}`}, made {transfer.entry_date}.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={e => void submit(e)}>
        {kind === 'confirm' ? <label className="block space-y-1 text-sm"><span>Bank account it arrived in</span>
          <select required className="h-11 w-full rounded-md border bg-background px-3" value={bank} disabled={busy} onChange={e => setBank(e.target.value)}>
            <option value="">Choose the bank account</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {banks.length === 0 && <span className="block text-muted-foreground">No bank accounts are set up. Add one in your chart of accounts first.</span>}
        </label> : <>
          <p className="text-sm">{transfer.kind === 'sale'
            ? 'The sale will be reversed: its revenue is taken back and the goods return to stock. This cannot be undone.'
            : 'The payment is dropped and the invoice stays outstanding. This cannot be undone.'}</p>
          <label className="block space-y-1 text-sm"><span>What happened</span>
            <Input required minLength={3} maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="For example: customer's transfer failed" /></label>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant={kind === 'confirm' ? 'default' : 'destructive'} disabled={busy || (kind === 'confirm' ? !bank : note.trim().length < 3)}>
          {busy ? 'Saving…' : kind === 'confirm' ? 'Confirm received' : 'Mark not received'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

/** BR-022: the owner decides whether the till may sell beyond recorded stock; every shortfall waits here for review. */
function StockControl({ onMessage }: { onMessage: (text: string) => void }) {
  const { business } = useBusiness();
  const owner = business?.userRole === 'owner';
  const [state, setState] = useState<{ allow_oversell: boolean; shortfalls: Shortfall[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await getStockControlAction();
    if (result.success) setState(result.data); else setError(result.error);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!state) return error ? <p role="alert" className="text-destructive">{error}</p> : null;
  async function toggle() {
    if (!state) return;
    setBusy(true); setError('');
    const result = await saveOversellAction(!state.allow_oversell);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onMessage(result.data.allow_oversell ? 'The till can now sell beyond recorded stock. Each shortfall is listed here for review.' : 'The till now stops at recorded stock.');
    void load();
  }
  async function review(item: Shortfall) {
    setBusy(true); setError('');
    const result = await reviewShortfallAction(item.sale_id, item.item_id);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    void load();
  }
  return <Card>
    <CardHeader><CardTitle>Stock sold beyond records</CardTitle>
      <CardDescription>{state.allow_oversell ? 'The till may sell more than recorded stock. Count the item and correct stock, then mark each one reviewed before you close the period.'
        : 'The till stops at recorded stock.'}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {owner && <Button variant="outline" disabled={busy} onClick={() => void toggle()}>{state.allow_oversell ? 'Stop selling beyond recorded stock' : 'Allow selling beyond recorded stock'}</Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {state.shortfalls.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : <ul className="space-y-2 text-sm">
        {state.shortfalls.map(s => <li key={s.sale_id + s.item_id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
          <span>{s.quantity} x {s.item} more than recorded, sale #{s.sale_id.slice(0, 8)} on {s.created_at.slice(0, 10)}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void review(s)}>Reviewed</Button>
        </li>)}
      </ul>}
    </CardContent>
  </Card>;
}
