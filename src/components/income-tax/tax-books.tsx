"use client";
// Income tax in the books (R4): once the tax year has ended, the Owner posts the year's estimated tax (Dr Income tax
// expense, Cr Income tax payable and WHT credits used); payments to the tax office are recorded against it. The Owner
// reverses the posting (while unpaid) or a payment, with a reason. Nothing changes the original entries.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { payTaxAction, postTaxAction, reverseTaxAction } from '@/app/accounting/income-tax/actions';
import { naira } from '@/lib/fixed-assets';
import type { IncomeTaxEstimate } from '@/lib/income-tax';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

export function TaxBooks({ view, role, banks, onChange }: { view: IncomeTaxEstimate; role: string; banks: { id: string; name: string }[];
  onChange: (next: IncomeTaxEstimate) => void }) {
  const owner = role === 'owner', manager = owner || role === 'admin';
  const { books } = view;
  const ended = view.period.end < today();
  const due = Number(view.companies_income_tax) + Number(view.development_levy);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [reversing, setReversing] = React.useState<string | null>(null), [reason, setReason] = React.useState('');
  const [pay, setPay] = React.useState({ amount: '', entry_date: today(), from: 'cash', reference: '' });
  const keys = React.useRef<Record<string, string>>({});
  const key = (what: string) => (keys.current[what] ||= crypto.randomUUID());

  const run = async (what: string, work: () => ReturnType<typeof postTaxAction>, after?: () => void) => {
    setBusy(true); setError('');
    const r = await work();
    setBusy(false);
    if (r.success) { delete keys.current[what]; onChange(r.data); after?.(); } else setError(r.error);
  };
  const reverse = (paymentId?: string) => run(`reverse:${paymentId ?? 'posting'}`,
    () => reverseTaxAction(view.year, key(`reverse:${paymentId ?? 'posting'}`), reason, paymentId), () => { setReversing(null); setReason(''); });
  const reverseForm = (id: string, label: string, paymentId?: string) => reversing === id && <form aria-label={label} className="flex flex-wrap items-center gap-2"
    onSubmit={e => { e.preventDefault(); void reverse(paymentId); }}>
    <Input aria-label="Why it is being reversed" placeholder="Why it is being reversed" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className="max-w-sm" />
    <Button type="submit" size="sm" disabled={busy}>{label}</Button>
    <Button type="button" size="sm" variant="ghost" onClick={() => setReversing(null)}>Cancel</Button>
  </form>;

  return <Card aria-label="In your books"><CardHeader><CardTitle>In your books</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!books.posted ? <>
        <p className="text-muted-foreground">{!ended ? `Once the year ends on ${view.period.end}, the Owner can post its tax to the books.`
          : due > 0 ? 'Post the tax when the estimate is final: income tax expense, and what you owe the tax office as income tax payable.'
          : 'There is no income tax or levy to post for this year.'}</p>
        {owner && ended && due > 0 && <Button disabled={busy} onClick={() => void run('post', () => postTaxAction(view.year, key('post')))}>{busy ? 'Posting…' : `Post ${naira(due)} to the books`}</Button>}
      </> : <>
        <p>Posted on {books.posted.entry_date}: income tax {naira(books.posted.companies_income_tax)}, development levy {naira(books.posted.development_levy)}
          {Number(books.posted.wht_used) > 0 && `, less withholding tax credits ${naira(books.posted.wht_used)}`}.</p>
        <p className="text-base font-medium">Still to pay: <span className="tabular-nums">{naira(books.outstanding ?? 0)}</span></p>
        {books.payments.length > 0 && <ul className="space-y-1">{books.payments.map(p => <li key={p.id} className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={p.reversed ? 'text-muted-foreground line-through' : undefined}>{p.entry_date} · from {p.paid_from}{p.reference ? ` (${p.reference})` : ''}</span>
            <span className="flex items-center gap-2"><span className="tabular-nums">{naira(p.amount)}</span>
              {owner && !p.reversed && reversing !== p.id && <Button size="sm" variant="ghost" onClick={() => { setReversing(p.id); setReason(''); }}>Reverse</Button>}</span>
          </div>
          {p.reversed && <p className="text-xs text-muted-foreground">Reversed: {p.reversal_reason}</p>}
          {reverseForm(p.id, 'Reverse payment', p.id)}
        </li>)}</ul>}
        {manager && Number(books.outstanding) > 0 && <form aria-label="Record a tax payment" className="grid gap-2 rounded-md border p-3 sm:grid-cols-4" onSubmit={e => { e.preventDefault();
          void run('pay', () => payTaxAction(view.year, key('pay'), { amount: pay.amount, entry_date: pay.entry_date, method: pay.from === 'cash' ? 'Cash' : 'Transfer',
            bank_account_id: pay.from === 'cash' ? null : pay.from, reference: pay.reference }), () => setPay(p => ({ ...p, amount: '', reference: '' }))); }}>
          <div className="space-y-1"><Label htmlFor="tax-paid">Amount paid (₦)</Label><Input id="tax-paid" inputMode="decimal" value={pay.amount} placeholder={books.outstanding ?? ''} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="tax-paid-on">Date paid</Label><Input id="tax-paid-on" type="date" max={today()} value={pay.entry_date} onChange={e => setPay(p => ({ ...p, entry_date: e.target.value }))} /></div>
          <div className="space-y-1"><Label htmlFor="tax-paid-from">Paid from</Label>
            <select id="tax-paid-from" className="h-9 w-full rounded-md border bg-background px-2" value={pay.from} onChange={e => setPay(p => ({ ...p, from: e.target.value }))}>
              <option value="cash">The till (cash)</option>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="tax-paid-ref">Receipt number (optional)</Label><Input id="tax-paid-ref" maxLength={120} value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} /></div>
          <Button type="submit" disabled={busy || !pay.amount} className="sm:col-span-4">Record payment</Button>
        </form>}
        {owner && !books.payments.some(p => !p.reversed) && reversing !== 'posting' && <Button size="sm" variant="ghost" onClick={() => { setReversing('posting'); setReason(''); }}>
          Reverse this posting</Button>}
        {reverseForm('posting', 'Reverse posting')}
      </>}
      {books.reversed.length > 0 && <p className="text-xs text-muted-foreground">Earlier postings reversed: {books.reversed.map(r => `${naira(r.payable)} (${r.reason})`).join('; ')}.</p>}
    </CardContent></Card>;
}
