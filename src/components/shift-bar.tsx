"use client"
// Cashier shifts on the till (Doc 10 shifts, PR-22): open with a float, pay cash in or out with a reason, and close by
// counting the cash. A request keeps its key across an uncertain retry, so it is never recorded twice.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cashMovementAction, closeShiftAction, getShiftAction, openShiftAction } from '@/app/pos/shift-actions';
import { naira } from '@/lib/transfers';
import { AMOUNT, differenceKobo, differenceText, openedAt, type Shift, type ShiftStatus } from '@/lib/shifts';

type Bank = { id: string; name: string };
type Attempt = { busy: boolean; error: string; uncertain: boolean };
const IDLE: Attempt = { busy: false, error: '', uncertain: false };

/** Runs a request under one key; the key changes only after a definite answer, so a lost response is retried safely. */
function useKeyedRequest() {
  const key = React.useRef(crypto.randomUUID());
  const [attempt, setAttempt] = React.useState<Attempt>(IDLE);
  const run = async <T,>(send: (key: string) => Promise<{ success: true; data: T } | { success: false; error: string; uncertain: boolean }>) => {
    setAttempt({ ...IDLE, busy: true });
    const result = await send(key.current);
    if (result.success) { key.current = crypto.randomUUID(); setAttempt(IDLE); return result.data; }
    if (!result.uncertain) key.current = crypto.randomUUID();
    setAttempt({ busy: false, error: result.error, uncertain: result.uncertain });
    return null;
  };
  const reset = () => { key.current = crypto.randomUUID(); setAttempt(IDLE); };
  return { attempt, run, reset };
}

function Problem({ text }: { text: string }) {
  return text ? <p role="alert" className="text-sm text-destructive">{text}</p> : null;
}

export function OpenShiftDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (shift: Shift) => void }) {
  const [float, setFloat] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const problem = float.trim() && !AMOUNT.test(float.trim()) ? 'Enter the cash in naira, for example 5000.' : '';
  const submit = async () => {
    const shift = await run(key => openShiftAction(key, float.trim() || '0'));
    if (shift) { setFloat(''); onDone(shift); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Open your shift</DialogTitle>
        <DialogDescription>Count the cash in the till before you start. Every sale and cash movement until you close is part of this shift.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm"><span>Cash in the till now (₦)</span>
        <Input inputMode="decimal" value={float} disabled={attempt.busy || attempt.uncertain} placeholder="0" onChange={e => setFloat(e.target.value)} /></label>
      <Problem text={problem || attempt.error} />
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Opening…' : 'Open shift'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CashMovementDialog({ shift, accounts, banks, open, onClose, onDone }: {
  shift: Shift; accounts: { id: string; code: string; name: string }[]; banks: Bank[]; open: boolean; onClose: () => void; onDone: (shift: Shift, text: string) => void;
}) {
  const [kind, setKind] = React.useState<'pay_out' | 'pay_in'>('pay_out');
  const [to, setTo] = React.useState<'expense' | 'bank'>('expense');
  const [amount, setAmount] = React.useState(''), [reason, setReason] = React.useState(''), [account, setAccount] = React.useState('');
  const [bank, setBank] = React.useState(banks.length === 1 ? banks[0].id : '');
  const { attempt, run, reset } = useKeyedRequest();
  const usesBank = kind === 'pay_in' || to === 'bank';
  const locked = attempt.busy || attempt.uncertain;
  const problem = !AMOUNT.test(amount.trim()) || Number(amount) <= 0 ? 'Enter the amount in naira, for example 2000.'
    : reason.trim().length < 3 ? 'Say what the cash is for.'
    : usesBank && !bank ? (kind === 'pay_in' ? 'Choose the bank account the cash came from.' : 'Choose the bank account it is paid into.')
    : !usesBank && !account ? 'Choose what the cash was spent on.' : '';
  const submit = async () => {
    const result = await run(key => cashMovementAction(shift.id, { requestKey: key, kind, amount: amount.trim(), reason: reason.trim(),
      expenseAccountId: usesBank ? undefined : account, bankAccountId: usesBank ? bank : undefined }));
    if (result) {
      setAmount(''); setReason('');
      onDone(result, `${naira(amount)} ${kind === 'pay_in' ? 'paid into' : 'paid out of'} the till.`);
    }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Pay cash in or out</DialogTitle>
        <DialogDescription>For example fuel bought from the till, or cash taken to the bank. Expected cash: {naira(shift.expected_cash)}.</DialogDescription></DialogHeader>
      <div className="grid gap-3">
        <div role="radiogroup" aria-label="Cash in or out" className="grid grid-cols-2 gap-2">
          {([['pay_out', 'Pay out'], ['pay_in', 'Pay in']] as const).map(([value, label]) =>
            <Button key={value} type="button" role="radio" aria-checked={kind === value} disabled={locked}
              variant={kind === value ? 'default' : 'outline'} onClick={() => setKind(value)}>{label}</Button>)}
        </div>
        {kind === 'pay_out' && <div role="radiogroup" aria-label="Where the cash went" className="grid grid-cols-2 gap-2">
          {([['expense', 'Spent on something'], ['bank', 'Into the bank']] as const).map(([value, label]) =>
            <Button key={value} type="button" role="radio" aria-checked={to === value} disabled={locked}
              variant={to === value ? 'default' : 'outline'} onClick={() => setTo(value)}>{label}</Button>)}
        </div>}
        <label className="space-y-1 text-sm"><span>Amount (₦)</span>
          <Input inputMode="decimal" value={amount} disabled={locked} onChange={e => setAmount(e.target.value)} /></label>
        {usesBank
          ? <label className="space-y-1 text-sm"><span>{kind === 'pay_in' ? 'Bank account it came from' : 'Bank account it was paid into'}</span>
              <select className="h-11 w-full rounded-md border bg-background px-3" value={bank} disabled={locked} onChange={e => setBank(e.target.value)}>
                <option value="">Choose a bank account</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
          : <label className="space-y-1 text-sm"><span>Spent on</span>
              <select className="h-11 w-full rounded-md border bg-background px-3" value={account} disabled={locked} onChange={e => setAccount(e.target.value)}>
                <option value="">Choose an expense</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>}
        <label className="space-y-1 text-sm"><span>Reason</span>
          <Input maxLength={500} value={reason} disabled={locked} placeholder="For example: diesel for the generator" onChange={e => setReason(e.target.value)} /></label>
        <Problem text={attempt.error || (amount || reason ? problem : '')} />
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Recording…' : kind === 'pay_in' ? 'Record pay-in' : 'Record pay-out'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CloseShiftDialog({ shift, open, onClose, onDone }: { shift: Shift; open: boolean; onClose: () => void; onDone: (shift: Shift) => void }) {
  const [counted, setCounted] = React.useState(''), [note, setNote] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const difference = differenceKobo(counted, shift.expected_cash);
  const locked = attempt.busy || attempt.uncertain;
  const problem = difference === null ? 'Enter the cash you counted, in naira.'
    : difference !== 0 && note.trim().length < 3 ? 'Say what happened to the difference.' : '';
  const submit = async () => {
    const result = await run(key => closeShiftAction(shift.id, key, counted.trim(), note.trim()));
    if (result) { setCounted(''); setNote(''); onDone(result); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Close {shift.mine ? 'your shift' : `${shift.opened_by_name}'s shift`}</DialogTitle>
        <DialogDescription>Count all the cash in the till. Any difference is recorded as cash over or short and shown to the owner.</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt>Float</dt><dd className="text-right">{naira(shift.opening_float)}</dd>
        <dt>Cash sales ({shift.sales} sales)</dt><dd className="text-right">{naira(shift.cash_sales)}</dd>
        {Number(shift.cash_refunds) > 0 && <><dt>Cash refunds</dt><dd className="text-right">−{naira(shift.cash_refunds)}</dd></>}
        {Number(shift.pay_ins) > 0 && <><dt>Paid in</dt><dd className="text-right">{naira(shift.pay_ins)}</dd></>}
        {Number(shift.pay_outs) > 0 && <><dt>Paid out</dt><dd className="text-right">−{naira(shift.pay_outs)}</dd></>}
        {Number(shift.cash_handed_back) > 0 && <><dt>Handed back on reversed sales</dt><dd className="text-right">−{naira(shift.cash_handed_back)}</dd></>}
        <dt className="font-semibold">Expected cash</dt><dd className="text-right font-semibold">{naira(shift.expected_cash)}</dd>
      </dl>
      <label className="space-y-1 text-sm"><span>Cash counted (₦)</span>
        <Input inputMode="decimal" value={counted} disabled={locked} onChange={e => setCounted(e.target.value)} /></label>
      {difference !== null && <p role="status" className={difference === 0 ? 'text-sm text-emerald-700' : 'text-sm font-semibold text-amber-700'}>{differenceText(difference)}</p>}
      {difference !== null && difference !== 0 && <label className="space-y-1 text-sm"><span>What happened</span>
        <Input maxLength={500} value={note} disabled={locked} onChange={e => setNote(e.target.value)} /></label>}
      <Problem text={attempt.error || (counted ? problem : '')} />
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Closing…' : 'Close shift'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** The till's shift strip. Reports the person's status so the till can stop sales when the owner requires a shift. */
export function ShiftBar({ banks, refreshKey, onStatus }: { banks: Bank[]; refreshKey?: unknown; onStatus?: (status: ShiftStatus | null) => void }) {
  const [status, setStatus] = React.useState<ShiftStatus | null>(null);
  const [error, setError] = React.useState('');
  const [dialog, setDialog] = React.useState<'open' | 'move' | 'close' | null>(null);
  const [notice, setNotice] = React.useState('');
  const report = React.useRef(onStatus);
  React.useEffect(() => { report.current = onStatus; });

  const load = React.useCallback(async () => {
    const result = await getShiftAction();
    if (result.success) { setStatus(result.data); setError(''); report.current?.(result.data); }
    else setError(result.error);
  }, []);
  React.useEffect(() => { void load(); }, [load, refreshKey]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error} <Button variant="link" className="h-auto p-0" onClick={() => void load()}>Retry</Button></p>;
  if (!status?.available) return null;
  const shift = status.shift;
  const done = (text: string) => { setDialog(null); setNotice(text); void load(); };

  return <section aria-label="Your shift" className="rounded-xl border bg-card p-3 text-sm flex flex-wrap items-center justify-between gap-3">
    {shift ? <div>
      <p className="font-semibold">Shift open since {openedAt(shift)}{shift.overdue ? ` on ${shift.opened_on}` : ''}</p>
      <p className="text-muted-foreground">Expected cash in the till: <span className="font-semibold text-foreground">{naira(shift.expected_cash)}</span></p>
      {shift.overdue && <p className="text-amber-700">This shift has been open since before midnight. Close it and open a new one.</p>}
    </div> : <div>
      <p className="font-semibold">No shift open</p>
      <p className={status.require_shift ? 'text-amber-700' : 'text-muted-foreground'}>
        {status.require_shift ? 'The owner requires a shift before you sell.' : 'Open a shift to count your till at the end of the day.'}</p>
    </div>}
    {notice && <p role="status" className="basis-full text-emerald-700 sm:basis-auto">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      {shift ? <>
        <Button size="sm" variant="outline" onClick={() => setDialog('move')}>Pay in or out</Button>
        <Button size="sm" onClick={() => setDialog('close')}>Close shift</Button>
      </> : <Button size="sm" onClick={() => setDialog('open')}>Open shift</Button>}
      <Button asChild size="sm" variant="ghost"><Link href="/pos/shifts">Shifts</Link></Button>
    </div>
    <OpenShiftDialog open={dialog === 'open'} onClose={() => setDialog(null)} onDone={s => done(`Shift opened with ${naira(s.opening_float)} in the till.`)} />
    {shift && <CashMovementDialog shift={shift} accounts={status.pay_out_accounts ?? []} banks={banks} open={dialog === 'move'}
      onClose={() => setDialog(null)} onDone={(_, text) => done(text)} />}
    {shift && <CloseShiftDialog shift={shift} open={dialog === 'close'} onClose={() => setDialog(null)}
      onDone={s => done(`Shift closed. ${differenceText(s.variance ?? '0')}.`)} />}
  </section>;
}
