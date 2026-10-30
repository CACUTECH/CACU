"use client";

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNgn } from '@/lib/cash-flow';
import type { OpeningAnswers, OpeningPosition } from '@/services/opening-position-service';
import { approveOpeningPositionAction, getOpeningPositionAction, saveOpeningPositionAction } from './actions';

/** SCR-03 Start your books (Doc 12 UJ-03, Doc 09 PR-01). The server values stock and builds the opening journal. */
const STEPS = ['Cash', 'Banks', 'Stock', 'Customers who owe you', 'Suppliers you owe', 'Loans', 'Money you put in', 'Review'] as const;
const MONEY = /^\d{0,13}(\.\d{0,2})?$/;

function ngn(value: string) {
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return formatNgn(`${value.startsWith('-') ? '-' : ''}${whole || '0'}.${(fraction + '00').slice(0, 2)}`);
}
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}
function emptyAnswers(data: OpeningPosition): OpeningAnswers {
  const saved = data.position?.answers;
  const amountFor = <T extends Record<string, string>>(list: T[] | undefined, key: keyof T, id: string) => list?.find(entry => entry[key] === id)?.amount ?? '';
  return {
    as_of: saved?.as_of || today(), cash: saved?.cash ?? '', loans: saved?.loans ?? '', capital: saved?.capital ?? '', notes: saved?.notes ?? '',
    banks: data.bank_accounts.map(b => ({ account_id: b.id, amount: amountFor(saved?.banks, 'account_id', b.id) })),
    customers: data.customers.map(c => ({ customer_id: c.id, amount: amountFor(saved?.customers, 'customer_id', c.id) })),
    suppliers: data.suppliers.map(s => ({ supplier_id: s.id, amount: amountFor(saved?.suppliers, 'supplier_id', s.id) })),
  };
}

function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₦</span>
        <Input id={id} inputMode="decimal" className="h-11 pl-7 tabular-nums" placeholder="0" value={value}
          onChange={event => { if (MONEY.test(event.target.value)) onChange(event.target.value); }} />
      </div>
    </div>
  );
}

export default function StartYourBooksPage() {
  const [data, setData] = React.useState<OpeningPosition | null>(null);
  const [answers, setAnswers] = React.useState<OpeningAnswers | null>(null);
  const [step, setStep] = React.useState(0);
  const [loadError, setLoadError] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [accountantView, setAccountantView] = React.useState(false);
  const [note, setNote] = React.useState('');
  // Kept until the save is confirmed or definitely refused, so a retry cannot save twice.
  const saveKey = React.useRef('');

  const load = React.useCallback(async () => {
    setLoadError('');
    setData(null);
    const result = await getOpeningPositionAction();
    if (!result.success) { setLoadError(result.error); return; }
    setData(result.data);
    setAnswers(emptyAnswers(result.data));
    if (result.data.position) setStep(STEPS.length - 1);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return <Shell><div className="space-y-3"><p role="alert" className="text-destructive">{loadError}</p>
      <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div></Shell>;
  }
  if (!data || !answers) {
    return <Shell><div role="status" className="flex items-center gap-3 py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" />Loading</div></Shell>;
  }
  if (data.books_active) return <Shell><p>Your books are live. Opening balances can no longer be changed here.</p></Shell>;
  if (!data.chart_ready) {
    return <Shell><p>First set up the standard accounts your books will use.</p>
      <Button asChild className="mt-4"><Link href="/accounting/chart-of-accounts">Go to Chart of Accounts</Link></Button></Shell>;
  }

  const position = data.position;
  const approved = position?.status === 'approved';
  const set = (patch: Partial<OpeningAnswers>) => setAnswers(current => current && { ...current, ...patch });

  const review = async () => {
    setBusy(true);
    setActionError('');
    saveKey.current ||= crypto.randomUUID();
    const result = await saveOpeningPositionAction(saveKey.current, position?.version ?? 0, answers);
    setBusy(false);
    if (!result.success) {
      if (!result.uncertain) saveKey.current = '';
      setActionError(result.error);
      return;
    }
    saveKey.current = '';
    setData(result.data);
    setStep(STEPS.length - 1);
  };
  const approve = async () => {
    if (!position) return;
    setBusy(true);
    setActionError('');
    const result = await approveOpeningPositionAction(position.version, note);
    setBusy(false);
    if (!result.success) { setActionError(result.error); return; }
    setData(result.data);
  };

  const question = STEPS[step];
  const reviewing = question === 'Review' && position;

  return (
    <Shell>
      <div className="space-y-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        <p className="text-xs text-muted-foreground">Step {step + 1} of {STEPS.length}: {question}</p>
      </div>

      {reviewing ? (
        <Review data={data} accountantView={accountantView} setAccountantView={setAccountantView} />
      ) : (
        <Card>
          <CardHeader><CardTitle>{question}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {question === 'Cash' && <>
              <div className="space-y-2">
                <Label htmlFor="as-of">Date your books start</Label>
                <Input id="as-of" type="date" max={today()} className="h-11" value={answers.as_of} onChange={event => set({ as_of: event.target.value })} />
              </div>
              <MoneyField id="cash" label="How much cash is in the till and safe now?" value={answers.cash} onChange={cash => set({ cash })} />
            </>}
            {question === 'Banks' && (answers.banks.length ? answers.banks.map((bank, index) => (
              <MoneyField key={bank.account_id} id={`bank-${index}`} label={`Money in ${data.bank_accounts[index]?.name ?? 'your bank account'}`} value={bank.amount}
                onChange={amount => set({ banks: answers.banks.map((b, i) => i === index ? { ...b, amount } : b) })} />
            )) : <p className="text-sm text-muted-foreground">Your chart has no bank account yet.</p>)}
            {question === 'Stock' && <>
              <p className="text-2xl font-bold tabular-nums">{ngn(data.stock_value)}</p>
              <p className="text-sm text-muted-foreground">
                This is the stock in your catalogue, counted at cost price. If it is wrong, update the stock counts or cost prices in{' '}
                <Link className="underline" href="/catalog">Catalogue</Link> first, then come back.
              </p>
            </>}
            {question === 'Customers who owe you' && (answers.customers.length ? answers.customers.map((entry, index) => (
              <MoneyField key={entry.customer_id} id={`customer-${index}`} label={data.customers[index]?.name ?? 'Customer'} value={entry.amount}
                onChange={amount => set({ customers: answers.customers.map((c, i) => i === index ? { ...c, amount } : c) })} />
            )) : <p className="text-sm text-muted-foreground">No customers yet. Add them in <Link className="underline" href="/customers">Customers</Link> if any owe you money.</p>)}
            {question === 'Suppliers you owe' && (answers.suppliers.length ? answers.suppliers.map((entry, index) => (
              <MoneyField key={entry.supplier_id} id={`supplier-${index}`} label={data.suppliers[index]?.name ?? 'Supplier'} value={entry.amount}
                onChange={amount => set({ suppliers: answers.suppliers.map((s, i) => i === index ? { ...s, amount } : s) })} />
            )) : <p className="text-sm text-muted-foreground">No suppliers yet. Add them in <Link className="underline" href="/settings/suppliers">Suppliers</Link> if you owe any money.</p>)}
            {question === 'Loans' && <MoneyField id="loans" label="How much do you still owe on loans?" value={answers.loans} onChange={loans => set({ loans })} />}
            {question === 'Money you put in' && <>
              <MoneyField id="capital" label="How much of your own money have you put into the business?" value={answers.capital} onChange={capital => set({ capital })} />
              <p className="text-sm text-muted-foreground">Leave it empty if you are not sure. The rest of the owner&apos;s money is treated as profit kept in the business.</p>
            </>}
            {question === 'Review' && <p className="text-sm text-muted-foreground">Save your answers to see what your business owns and owes.</p>}
          </CardContent>
        </Card>
      )}

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {reviewing ? (
          <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>Change answers</Button>
        ) : (
          <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={busy || step === 0}>Back</Button>
        )}
        {reviewing ? (approved ? (
          <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Approved by {position.approved_by} on {new Date(position.approved_at!).toLocaleDateString('en-NG')}. CACU turns on your books after its checks.</p>
        ) : (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input aria-label="Note for your records (optional)" placeholder="Note (optional)" value={note} onChange={event => setNote(event.target.value.slice(0, 1000))} className="h-11" />
            <Button onClick={() => void approve()} disabled={busy} className="h-11">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve opening position</Button>
          </div>
        )) : question === 'Money you put in' || question === 'Review' ? (
          <Button onClick={() => void review()} disabled={busy} className="h-11">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Review</Button>
        ) : (
          <Button onClick={() => setStep(step + 1)} className="h-11">Next</Button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-headline text-3xl font-bold tracking-tight">Start your books</h1>
        <p className="text-muted-foreground">A few questions about where your business stands today. Only cash is required.</p>
      </div>
      {children}
    </div>
  );
}

function Review({ data, accountantView, setAccountantView }: { data: OpeningPosition; accountantView: boolean; setAccountantView: (value: boolean) => void }) {
  const position = data.position!;
  const s = position.summary;
  const negative = s.owner_equity.startsWith('-');
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-4 py-2 ${strong ? 'border-t font-semibold' : ''}`}><span>{label}</span><span className="tabular-nums">{ngn(value)}</span></div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>What your business owns and owes on {new Date(position.as_of).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</CardTitle>
        <CardDescription>Version {position.version}{position.status === 'approved' ? ', approved' : ', not yet approved'}</CardDescription>
      </CardHeader>
      <CardContent>
        {accountantView ? (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
            <TableBody>
              {position.journal.lines.map((line, index) => {
                const party = line.party_type === 'customers' ? data.customers.find(c => c.id === line.party_id)?.name : data.suppliers.find(c => c.id === line.party_id)?.name;
                return (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-xs">{line.code}</TableCell>
                    <TableCell>{line.name}{party ? ` (${party})` : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.side === 'debit' ? ngn(line.amount) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.side === 'credit' ? ngn(line.amount) : ''}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="text-sm">
            <p className="font-semibold">What you own</p>
            {row('Cash', s.cash)}{row('Money in the bank', s.banks)}{row('Stock', s.stock)}{row('Customers owe you', s.customers)}{row('Total you own', s.owns, true)}
            <p className="mt-4 font-semibold">What you owe</p>
            {row('Suppliers you owe', s.suppliers)}{row('Loans', s.loans)}{row('Total you owe', s.owes, true)}
            <p className="mt-4 font-semibold">{negative ? 'You owe more than the business owns' : "Owner's money in the business"}</p>
            {row('Money you put in', s.capital)}{row(negative ? 'Losses so far' : 'Profit kept in the business', s.retained)}{row("Owner's money", s.owner_equity, true)}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex items-center gap-2">
        <Switch id="accountant-view" checked={accountantView} onCheckedChange={setAccountantView} />
        <Label htmlFor="accountant-view">Accountant view</Label>
      </CardFooter>
    </Card>
  );
}
