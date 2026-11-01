"use client";
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CollectionAccount } from '@/lib/collection-accounts';
import type { ExpenseAccount, SupplierBill } from '@/lib/corrections';
import { getBillsAction, paySupplierBillAction, recordBillAction } from './actions';

const today = () => new Date().toLocaleDateString('en-CA');
const naira = (amount: string) => `NGN ${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const AMOUNT = /^[0-9]{1,13}(\.[0-9]{1,2})?$/;
const STATUS = { unpaid: 'Unpaid', part_paid: 'Part paid', paid: 'Paid' } as const;
const blankBill = () => ({ supplier_id: '', bill_number: '', entry_date: today(), due_date: '', account_id: '', amount: '', description: '' });
type State = { native: boolean; bills: SupplierBill[]; accounts: ExpenseAccount[]; banks: CollectionAccount[]; suppliers: { id: string; name: string }[] };

export default function BillsPage() {
  const { business } = useBusiness();
  const writer = ['owner', 'admin', 'editor'].includes(business?.userRole ?? '');
  const [state, setState] = useState<State | null>(null), [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(blankBill()), [key, setKey] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [paying, setPaying] = useState<SupplierBill | null>(null);
  const load = useCallback(async () => {
    const result = await getBillsAction();
    if (result.success) { setState(result.data); setLoadError(''); } else setLoadError(result.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!AMOUNT.test(form.amount) || Number(form.amount) <= 0) { setError('Enter an amount above zero with at most two decimal places.'); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError(''); setSaved('');
    const result = await recordBillAction({ request_key: requestKey, supplier_id: form.supplier_id, bill_number: form.bill_number.trim(), entry_date: form.entry_date,
      ...(form.due_date ? { due_date: form.due_date } : {}), notes: '', lines: [{ account_id: form.account_id, amount: form.amount, description: form.description.trim() }] });
    setBusy(false);
    if (result.success) { setKey(null); setForm(blankBill()); setSaved('Bill recorded.'); await load(); return; }
    if (!result.uncertain) setKey(null);
    setError(result.error);
  }
  const locked = busy || key !== null;
  const set = (name: keyof ReturnType<typeof blankBill>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [name]: e.target.value }));
  const owed = state?.bills.reduce((sum, b) => sum + Number(b.outstanding), 0) ?? 0;

  return <div className="space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Bills</h1><p className="text-muted-foreground">What you owe suppliers, and paying it.</p></div>
    {loadError ? <div><p role="alert" className="text-destructive">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div>
      : !state ? <p role="status">Loading bills...</p>
      : !state.native ? <Card><CardContent className="space-y-2 pt-6"><p>Bills are recorded here once your books are live.</p><p className="text-sm text-muted-foreground"><Link className="underline" href="/setup/books">Start your books</Link></p></CardContent></Card>
      : <>
        {writer && <Card><CardHeader><CardTitle>Record a bill</CardTitle></CardHeader><CardContent>
          {!state.suppliers.length ? <p className="text-sm">Add a supplier first, then record their bills here.</p> :
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Supplier</span><select aria-label="Supplier" required className="w-full rounded-md border bg-background p-2" value={form.supplier_id} disabled={locked} onChange={set('supplier_id')}>
              <option value="">Choose a supplier</option>{state.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>Their bill number</span><Input required maxLength={100} value={form.bill_number} disabled={locked} onChange={set('bill_number')}/></label>
            <label className="space-y-1 text-sm"><span>Bill date</span><Input type="date" required max={today()} value={form.entry_date} disabled={locked} onChange={set('entry_date')}/></label>
            <label className="space-y-1 text-sm"><span>Due date (optional)</span><Input type="date" min={form.entry_date} value={form.due_date} disabled={locked} onChange={set('due_date')}/></label>
            <label className="space-y-1 text-sm"><span>What was it for?</span><select aria-label="Expense account" required className="w-full rounded-md border bg-background p-2" value={form.account_id} disabled={locked} onChange={set('account_id')}>
              <option value="">Choose an account</option>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>Amount (NGN)</span><Input inputMode="decimal" required value={form.amount} disabled={locked} onChange={set('amount')}/></label>
            <label className="space-y-1 text-sm sm:col-span-2"><span>Description (optional)</span><Input maxLength={500} value={form.description} disabled={locked} onChange={set('description')}/></label>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs text-muted-foreground">Goods bought for stock are recorded with a goods receipt, which is coming later.</p>
              {error && <p role="alert" className="text-destructive">{error}</p>}{saved && <p role="status">{saved}</p>}
              {key && !busy && <p className="text-sm">We could not confirm the bill. Retry sends the same request, so it cannot be recorded twice.</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Recording...' : key ? 'Retry' : 'Record bill'}</Button>
            </div>
          </form>}
        </CardContent></Card>}
        <section aria-label="Bills" className="space-y-3">
          <h2 className="text-lg font-semibold">Bills <span className="text-sm font-normal text-muted-foreground">· you owe {naira(owed.toFixed(2))}</span></h2>
          {!state.bills.length ? <p className="text-sm text-muted-foreground">No bills yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr>{['Supplier', 'Bill', 'Date', 'Due', 'Total', 'Still owed', 'Status', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{state.bills.map(b => <tr key={b.id} className="border-t">
              <td className="p-2">{b.supplier_name}</td><td className="p-2">{b.bill_number}</td><td className="p-2">{b.date}</td><td className="p-2">{b.due_date ?? ''}</td>
              <td className="p-2">{naira(b.total)}</td><td className="p-2">{naira(b.outstanding)}</td><td className="p-2">{STATUS[b.status]}</td>
              <td className="p-2">{writer && b.status !== 'paid' && <Button size="sm" variant="outline" onClick={() => setPaying(b)}>Pay</Button>}</td>
            </tr>)}</tbody></table></div>}
        </section>
        {paying && <PayDialog bill={paying} banks={state.banks} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); void load(); }}/>}
      </>}
  </div>;
}

function PayDialog({ bill, banks, onClose, onPaid }: { bill: SupplierBill; banks: CollectionAccount[]; onClose: () => void; onPaid: () => void }) {
  const [form, setForm] = useState({ amount: bill.outstanding, entry_date: today(), method: (banks.length ? 'Transfer' : 'Cash') as 'Cash' | 'Transfer', bank_account_id: banks[0]?.id ?? '' });
  const [key, setKey] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!AMOUNT.test(form.amount) || Number(form.amount) <= 0) { setError('Enter an amount above zero with at most two decimal places.'); return; }
    if (Number(form.amount) > Number(bill.outstanding)) { setError(`You owe ${naira(bill.outstanding)} on this bill.`); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await paySupplierBillAction(bill.id, { request_key: requestKey, amount: form.amount, entry_date: form.entry_date, method: form.method,
      ...(form.method === 'Transfer' ? { bank_account_id: form.bank_account_id } : {}) });
    setBusy(false);
    if (result.success) { onPaid(); return; }
    if (!result.uncertain) setKey(null);
    setError(result.error);
  }
  const locked = busy || key !== null;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>Pay {bill.supplier_name}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">{bill.bill_number}: {naira(bill.outstanding)} still owed.</p>
      <label className="block space-y-1 text-sm"><span>Amount paid (NGN)</span><Input inputMode="decimal" required value={form.amount} disabled={locked} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}/></label>
      <label className="block space-y-1 text-sm"><span>Date paid</span><Input type="date" required min={bill.date} max={today()} value={form.entry_date} disabled={locked} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}/></label>
      <label className="block space-y-1 text-sm"><span>Paid with</span><select aria-label="Paid with" className="w-full rounded-md border bg-background p-2" value={form.method} disabled={locked}
        onChange={e => setForm(f => ({ ...f, method: e.target.value as 'Cash' | 'Transfer' }))}><option value="Transfer" disabled={!banks.length}>Bank transfer</option><option value="Cash">Cash</option></select></label>
      {form.method === 'Transfer' && <label className="block space-y-1 text-sm"><span>From which bank account?</span><select aria-label="Bank account" required className="w-full rounded-md border bg-background p-2"
        value={form.bank_account_id} disabled={locked} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}>
        <option value="">Choose a bank account</option>{banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {key && !busy && <p className="text-sm">We could not confirm the payment. Retry sends the same request, so it cannot be paid twice.</p>}
      <Button type="submit" disabled={busy}>{busy ? 'Paying...' : key ? 'Retry payment' : 'Record payment'}</Button>
    </form>
  </DialogContent></Dialog>;
}
