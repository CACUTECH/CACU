"use client";
// Customer statement (Doc 10 E11, Doc 11 GET /customers/{id}/statement): invoices, payments and advances between two
// dates with a running balance, ready to print or save as PDF for the customer. Owners and Admins can hand back an advance.
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/components/business-provider';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { customerStatementAction, refundAdvanceAction } from '@/app/invoices/receivables-actions';
import { CollectionAccountPicker } from '@/components/collection-account-picker';
import type { CollectionAccounts } from '@/lib/collection-accounts';
import { lagosToday, naira, type Statement } from '@/lib/receivables';

const monthsBack = (today: string, months: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months, 1); return d.toISOString().slice(0, 10); };

function HandBack({ customerId, held, onDone }: { customerId: string; held: string; onDone: (message: string) => void }) {
  const [amount, setAmount] = React.useState(held), [note, setNote] = React.useState('');
  const [method, setMethod] = React.useState<'Cash' | 'Transfer'>('Cash'), [bank, setBank] = React.useState('');
  const [choices, setChoices] = React.useState<CollectionAccounts | null>(null), [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  React.useEffect(() => { void getCollectionAccountsAction().then(setChoices).catch(() => setError('Payment accounts unavailable.')); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { setError('Enter an amount above zero.'); return; }
    if (note.trim().length < 3) { setError('Say why the advance is handed back.'); return; }
    if (method === 'Transfer' && !bank) { setError('Choose the bank account it is paid from.'); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError('');
    const result = await refundAdvanceAction(customerId, { request_key: requestKey, amount, method, bank_account_id: method === 'Transfer' ? bank : null, note: note.trim() });
    setBusy(false);
    if (!result.success) { if (!result.uncertain) setKey(null); setError(result.error); return; }
    onDone(`${naira(amount)} handed back. Advance still held: ${naira(result.data.advance)}.`);
  };
  return <form onSubmit={submit} className="space-y-3 rounded-xl border p-4 print:hidden">
    <h2 className="font-semibold">Hand back the advance</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="refund-amount">Amount (NGN)</Label><Input id="refund-amount" inputMode="decimal" value={amount} disabled={busy || !!key} onChange={e => setAmount(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="refund-note">Reason</Label><Input id="refund-note" maxLength={500} value={note} disabled={busy || !!key} onChange={e => setNote(e.target.value)} /></div>
    </div>
    {choices && <CollectionAccountPicker method={method} bankAccountId={bank} choices={choices} disabled={busy || !!key} onMethodChange={setMethod} onBankChange={setBank} />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" variant="outline" disabled={busy || !choices}>{busy ? 'Recording…' : key ? 'Retry' : 'Hand back'}</Button>
  </form>;
}

function StatementView() {
  const search = useSearchParams();
  const { business } = useBusiness();
  const today = lagosToday();
  const [customers, setCustomers] = React.useState<{ id: string; name: string }[]>([]);
  const [customer, setCustomer] = React.useState(search.get('customer') ?? '');
  const [start, setStart] = React.useState(monthsBack(today, 2)), [end, setEnd] = React.useState(today);
  const [statement, setStatement] = React.useState<Statement | null>(null), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    void (async () => {
      const { data } = await createClient().from('customers').select('id, name').eq('business_id', await getActiveBusinessIdAction()).order('name');
      setCustomers(data ?? []);
    })().catch(() => setError('Customers are unavailable. Refresh to try again.'));
  }, []);
  React.useEffect(() => {
    setStatement(null);
    if (!customer || !start || !end) return;
    let live = true;
    void customerStatementAction(customer, start, end).then(r => { if (!live) return; if (r.success) { setStatement(r.data); setError(''); } else setError(r.error); });
    return () => { live = false; };
  }, [customer, start, end, version]);

  const canHandBack = business?.userRole === 'owner' || business?.userRole === 'admin';
  return <div className="max-w-4xl space-y-6">
    <div className="print:hidden"><Link href="/invoices" className="text-sm underline">Back to invoices</Link>
      <h1 className="font-headline text-3xl font-bold">Customer statement</h1>
      <p className="text-muted-foreground">What a customer was invoiced, what they paid and what they owe. Print it or save it as a PDF to send.</p></div>
    <div className="grid gap-3 sm:grid-cols-4 print:hidden">
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="statement-customer">Customer</Label>
        <select id="statement-customer" className="h-10 w-full rounded-md border bg-background px-3" value={customer} onChange={e => setCustomer(e.target.value)}>
          <option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="statement-start">From</Label><Input id="statement-start" type="date" value={start} max={end} onChange={e => setStart(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="statement-end">To</Label><Input id="statement-end" type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></div>
    </div>
    {message && <p role="status" className="text-emerald-700 print:hidden">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {customer && !statement && !error && <p role="status" className="text-muted-foreground">Loading…</p>}
    {statement && <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-lg font-semibold">{business?.name}</p><p>Statement for <span className="font-medium">{statement.customer.name}</span>, {statement.start} to {statement.end}</p></div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>Print or save as PDF</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Date</th><th>Entry</th><th>Reference</th><th className="text-right">Charged</th><th className="text-right">Paid</th><th className="p-2 text-right">Balance</th></tr></thead>
        <tbody>
          <tr className="border-b"><td className="p-2">{statement.start}</td><td colSpan={4}>Brought forward</td><td className="p-2 text-right">{naira(statement.opening)}</td></tr>
          {statement.lines.map((l, i) => <tr key={i} className="border-b"><td className="p-2">{l.date}</td><td>{l.kind}</td><td>{l.reference}</td>
            <td className="text-right">{Number(l.debit) ? naira(l.debit) : ''}</td><td className="text-right">{Number(l.credit) ? naira(l.credit) : ''}</td>
            <td className="p-2 text-right">{naira(l.balance)}</td></tr>)}
        </tbody>
        <tfoot><tr><td className="p-2 font-semibold" colSpan={5}>{Number(statement.closing) < 0 ? 'In credit' : 'Owed'} on {statement.end}</td>
          <td className="p-2 text-right font-semibold">{naira(Math.abs(Number(statement.closing)))}</td></tr></tfoot>
      </table></div>
      {statement.lines.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this period.</p>}
      <p className="text-xs text-muted-foreground">Transfers waiting for confirmation are not on the statement yet.{Number(statement.advance_held) > 0 && ` Advance held on ${statement.end}: ${naira(statement.advance_held)}.`}</p>
      {canHandBack && Number(statement.advance_held) > 0 && statement.end === today &&
        <HandBack customerId={statement.customer.id} held={statement.advance_held} onDone={text => { setMessage(text); setVersion(v => v + 1); }} />}
    </section>}
  </div>;
}

// useSearchParams needs a Suspense boundary for the production build.
export default function StatementPage() {
  return <React.Suspense fallback={null}><StatementView /></React.Suspense>;
}
