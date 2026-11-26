"use client";
// Payroll in the books (Doc 03 FR-203; E21 R4), on an approved run. An Owner or Admin posts the run as one journal,
// then records paying staff and remitting PAYE, pension, NHF and NHIS against it, never more than is owed. Hidden
// while CACU's payroll switch is off (until a professional has validated payroll posting).
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { payrollBooksAction, postPayrollAction, settlePayrollAction } from '@/app/hr/payroll/books-actions';
import { SETTLEMENT_LABELS, type PayrollBooks, type PayrollBooksRun, type SettlementKind } from '@/lib/payroll-books';

const KINDS = Object.keys(SETTLEMENT_LABELS) as SettlementKind[];
const money = (v: string | number) => `₦${Number(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);  // Lagos is UTC+1

export function PayrollBooksPanel({ runId }: { runId: string }) {
  const [books, setBooks] = React.useState<PayrollBooks | null>(null);
  const [state, setState] = React.useState<PayrollBooksRun | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ kind: 'net_pay' as SettlementKind, amount: '', entry_date: today(), method: 'Cash' as 'Cash' | 'Transfer', bank_account_id: '', reference: '' });
  const postKey = React.useRef('');
  const payKey = React.useRef('');

  React.useEffect(() => {
    void payrollBooksAction().then(r => {
      // Someone without payroll.approve simply does not see the panel.
      if (!r.success) { if (!/permission/i.test(r.error)) setError(r.error); else setBooks({ enabled: false, message: null, runs: [], pay_from: { cash: false, banks: [] } }); return; }
      setBooks(r.data);
      if (!r.data.pay_from.cash && r.data.pay_from.banks[0]) setForm(f => ({ ...f, method: 'Transfer', bank_account_id: r.data.pay_from.banks[0].id }));
      setState(r.data.runs.find(x => x.run.id === runId) ?? null);
    });
  }, [runId]);

  if (!books && !error) return null;
  if (books && !books.enabled) return null;  // off until the R4 gate: nothing to show
  if (!books) return <p role="alert" className="text-sm text-destructive">{error}</p>;

  const post = async () => {
    setBusy(true); setError('');
    postKey.current ||= crypto.randomUUID();
    try {
      const r = await postPayrollAction(runId, postKey.current);
      if (r.success) setState(r.data); else setError(r.error);
    } finally { setBusy(false); }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    payKey.current ||= crypto.randomUUID();
    try {
      const r = await settlePayrollAction(runId, payKey.current, { ...form, bank_account_id: form.method === 'Transfer' ? form.bank_account_id : null, reference: form.reference || null });
      if (r.success) { setState(r.data); payKey.current = ''; setForm(f => ({ ...f, amount: '', reference: '' })); } else setError(r.error);
    } finally { setBusy(false); }
  };

  const owed = state?.outstanding;
  return <Card aria-label="Payroll in the books">
    <CardHeader><CardTitle>Payroll in the books</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!state?.posted ? <div className="space-y-2">
        <p>Post this payroll to your books as one journal: salaries and employer pension as costs, and what you now owe staff, the tax
          authority, pension fund administrators, NHF and NHIS as amounts to pay. It is dated the last day of the month, or today if that is still to come.</p>
        <Button onClick={() => void post()} disabled={busy}>{busy ? 'Posting…' : 'Post to the books'}</Button>
      </div> : <>
        <p>Posted to the books on {state.posted.entry_date}.</p>
        <table className="w-full"><thead><tr className="text-muted-foreground"><th className="text-left font-normal">Still to pay</th><th className="text-right font-normal">Amount</th></tr></thead>
          <tbody>{KINDS.map(k => <tr key={k}><td>{SETTLEMENT_LABELS[k]}</td><td className="text-right tabular-nums">{money(owed?.[k] ?? 0)}</td></tr>)}</tbody></table>

        {KINDS.some(k => Number(owed?.[k] ?? 0) > 0) && <form onSubmit={e => void pay(e)} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2" aria-label="Record a payment">
          <div className="space-y-1"><Label htmlFor="pay-kind">What you paid</Label>
            <select id="pay-kind" className="h-9 w-full rounded-md border bg-background px-2" value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as SettlementKind }))}>
              {KINDS.filter(k => Number(owed?.[k] ?? 0) > 0).map(k => <option key={k} value={k}>{SETTLEMENT_LABELS[k]}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="pay-amount">Amount (₦)</Label>
            <Input id="pay-amount" inputMode="decimal" value={form.amount} placeholder={owed?.[form.kind]} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="pay-date">Date paid</Label>
            <Input id="pay-date" type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="pay-from">Paid from</Label>
            <select id="pay-from" className="h-9 w-full rounded-md border bg-background px-2" value={form.method === 'Cash' ? 'cash' : form.bank_account_id}
              onChange={e => setForm(f => e.target.value === 'cash' ? { ...f, method: 'Cash', bank_account_id: '' } : { ...f, method: 'Transfer', bank_account_id: e.target.value })}>
              {books.pay_from.cash && <option value="cash">Cash (the till)</option>}
              {books.pay_from.banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" maxLength={120} value={form.reference} placeholder="For example, the remittance receipt number" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
          <Button type="submit" disabled={busy || !form.amount} className="sm:col-span-2">{busy ? 'Recording…' : 'Record payment'}</Button>
        </form>}

        {state.settlements.length > 0 && <div><p className="font-medium">Payments recorded</p>
          <ul className="space-y-1">{state.settlements.map(s => <li key={s.id} className="flex flex-wrap justify-between gap-2">
            <span>{s.entry_date} · {s.label} from {s.paid_from}{s.reference ? ` (${s.reference})` : ''}</span><span className="tabular-nums">{money(s.amount)}</span>
          </li>)}</ul></div>}
      </>}
    </CardContent>
  </Card>;
}
