"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import Link from 'next/link';
import { differenceText, openedAt, type ShiftsDay } from '@/lib/shifts';
import { confirmTransferAction, decideRefundAction, getDailyReconciliationAction, getRefundLimitAction, getStockControlAction, reviewShortfallAction, saveOversellAction,
  saveRefundLimitAction, transferNotReceivedAction, type Shortfall } from './actions';
import type { Refund } from '@/lib/checkout';
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
    {report?.shifts && <Shifts shifts={report.shifts} />}
    {report && <Refunds report={report} banks={banks} onMessage={text => { setMessage(text); void load(); }} />}
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

/** Doc 10 refunds (PR-16, FR-044): what was paid back on the day, refunds waiting for an approver, and the owner's limit. */
function Refunds({ report, banks, onMessage }: { report: DailyReconciliation; banks: CollectionAccount[]; onMessage: (text: string) => void }) {
  const { business } = useBusiness();
  const owner = business?.userRole === 'owner';
  const [deciding, setDeciding] = useState<{ refund: Refund; approve: boolean } | null>(null);
  const paid = Object.entries(report.refunds ?? {}), waiting = report.refunds_pending ?? [];
  return <Card>
    <CardHeader><CardTitle>Refunds</CardTitle>
      <CardDescription>{paid.length === 0 ? 'No refunds paid on this day.'
        : paid.map(([method, r]) => `${naira(r.total)} by ${(METHOD_LABELS[method] ?? method).toLowerCase()} (${r.refunds})`).join(', ') + ' paid back.'}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {waiting.length === 0 ? <p className="text-sm text-muted-foreground">No refunds waiting for approval.</p>
        : <ul className="space-y-2 text-sm" aria-label="Refunds waiting for approval">
          {waiting.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
            <span><span className="font-medium">{naira(r.amount)}</span> by {r.method === 'cash' ? 'cash' : 'transfer'} for receipt {r.sale_number}: {r.items}.
              <span className="block text-muted-foreground">{r.requested_by_name}: {r.reason}</span></span>
            <span className="flex gap-2">
              {!r.mine && <Button size="sm" onClick={() => setDeciding({ refund: r, approve: true })}>Approve</Button>}
              <Button size="sm" variant="outline" onClick={() => setDeciding({ refund: r, approve: false })}>{r.mine ? 'Withdraw' : 'Reject'}</Button>
            </span>
          </li>)}
        </ul>}
      {owner && <RefundLimit onMessage={onMessage} />}
    </CardContent>
    {deciding && <RefundDecisionDialog key={deciding.refund.id + deciding.approve} {...deciding} banks={banks} onClose={() => setDeciding(null)}
      onDone={text => { setDeciding(null); onMessage(text); }} />}
  </Card>;
}

function RefundDecisionDialog({ refund, approve, banks, onClose, onDone }: {
  refund: Refund; approve: boolean; banks: CollectionAccount[]; onClose: () => void; onDone: (text: string) => void;
}) {
  const [bank, setBank] = useState(refund.bank_account_id ?? (banks.length === 1 ? banks[0].id : ''));
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const needsBank = approve && refund.method === 'transfer', needsNote = !approve && !refund.mine;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const result = await decideRefundAction(refund.id, approve, note.trim(), needsBank ? bank : undefined);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onDone(approve ? `Refund of ${naira(refund.amount)} paid ${refund.method === 'cash' ? 'from the till' : 'by transfer'}.` : refund.mine ? 'Refund request withdrawn.' : 'Refund rejected.');
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{approve ? 'Approve refund' : refund.mine ? 'Withdraw refund request' : 'Reject refund'}</DialogTitle>
        <DialogDescription>{naira(refund.amount)} for receipt {refund.sale_number}: {refund.items}. {refund.reason}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={e => void submit(e)}>
        {needsBank && <label className="block space-y-1 text-sm"><span>Bank account it is paid from</span>
          <select required className="h-11 w-full rounded-md border bg-background px-3" value={bank} disabled={busy} onChange={e => setBank(e.target.value)}>
            <option value="">Choose the bank account</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>}
        {approve && refund.method === 'cash' && <p className="text-sm">Hand {naira(refund.amount)} back from the till.</p>}
        <label className="block space-y-1 text-sm"><span>{needsNote ? 'Why it is rejected' : 'Note (optional)'}</span>
          <Input required={needsNote} maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant={approve ? 'default' : 'destructive'} disabled={busy || (needsBank && !bank) || (needsNote && note.trim().length === 0)}>
          {busy ? 'Saving…' : approve ? 'Approve and pay' : refund.mine ? 'Withdraw' : 'Reject'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

/** The owner's rule (FR-044): approvers refund at once up to this amount; above it a second person approves. */
function RefundLimit({ onMessage }: { onMessage: (text: string) => void }) {
  const [saved, setSaved] = useState<string | null | undefined>(undefined), [value, setValue] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    void getRefundLimitAction().then(r => { if (r.success) { setSaved(r.data); setValue(r.data ? String(Number(r.data)) : ''); } });
  }, []);
  if (saved === undefined) return null;
  const valid = value === '' || /^\d{1,13}(\.\d{1,2})?$/.test(value);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    const result = await saveRefundLimitAction(value === '' ? null : value);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setSaved(result.data.refund_threshold);
    onMessage(result.data.refund_threshold ? `Refunds above ${naira(result.data.refund_threshold)} now need a second person to approve.` : 'Approvers can now refund any amount at once.');
  }
  return <form className="flex flex-wrap items-end gap-2 border-t pt-3 text-sm" onSubmit={e => void save(e)}>
    <label className="space-y-1"><span className="block">Refund limit without a second approver (₦, empty for no limit)</span>
      <Input aria-label="Refund limit (₦)" inputMode="decimal" className="w-40" value={value} disabled={busy} onChange={e => setValue(e.target.value)} /></label>
    <Button type="submit" variant="outline" disabled={busy || !valid || value === (saved ? String(Number(saved)) : '')}>Save limit</Button>
    <span className="w-full text-xs text-muted-foreground">Cashiers&apos; refunds always wait for an Owner, Admin or Sales manager.</span>
    {error && <p role="alert" className="w-full text-destructive">{error}</p>}
  </form>;
}

/** Doc 10: shift variances for the day (PR-22), and shifts still open, flagged once they run past midnight. */
function Shifts({ shifts }: { shifts: ShiftsDay }) {
  const short = shifts.closed.filter(s => Number(s.variance) !== 0);
  return <Card>
    <CardHeader><CardTitle>Shifts</CardTitle>
      <CardDescription>{shifts.closed.length === 0 ? 'No shifts closed on this day.'
        : `${shifts.closed.length} closed. ${short.length === 0 ? 'Every till matched its expected cash.' : `Differences in all: ${differenceText(shifts.variance_total)}.`}`}</CardDescription></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {short.length > 0 && <ul className="space-y-1" aria-label="Shift differences">
        {short.map(s => <li key={s.id}><span className="font-medium">{s.opened_by_name}</span>: <span className="font-semibold text-amber-700">{differenceText(s.variance ?? '0')}</span>
          {s.close_note ? ` (${s.close_note})` : ''}</li>)}
      </ul>}
      {shifts.open.length > 0 && <ul className="space-y-1" aria-label="Shifts still open">
        {shifts.open.map(s => <li key={s.id}>{s.opened_by_name}: open since {s.overdue ? `${s.opened_on}, ` : ''}{openedAt(s)}
          {s.overdue && <Badge variant="destructive" className="ml-2">Open past midnight</Badge>}</li>)}
      </ul>}
      <Link className="underline" href="/pos/shifts">See all shifts</Link>
    </CardContent>
  </Card>;
}
