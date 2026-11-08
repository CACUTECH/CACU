"use client";
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { PostedEntries } from '@/components/posted-entries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CollectionAccount } from '@/lib/collection-accounts';
import type { ExpenseAccount, PostedEntry } from '@/lib/corrections';
import { getExpensesAction, recordExpenseAction, reverseExpenseAction } from './actions';
import { createClient } from '@/lib/supabase/client';
import { keepExpense, loadSnapshot, online, saveSnapshot } from '@/lib/offline-outbox';
import { useOfflineSync } from '@/hooks/use-offline-sync';

const today = () => new Date().toLocaleDateString('en-CA');
const blank = () => ({ expense_account_id: '', amount: '', entry_date: today(), method: 'Cash' as 'Cash' | 'Transfer', bank_account_id: '', description: '' });

export default function ExpensesPage() {
  const { business } = useBusiness();
  const writer = ['owner', 'admin', 'editor'].includes(business?.userRole ?? ''), manager = ['owner', 'admin'].includes(business?.userRole ?? '');
  const [state, setState] = useState<{ native: boolean; accounts: ExpenseAccount[]; banks: CollectionAccount[]; expenses: PostedEntry[] } | null>(null);
  const [loadError, setLoadError] = useState(''), [form, setForm] = useState(blank()), [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  // Doc 10 E17: without a connection an expense waits on this phone and is sent when it is back online.
  const [userId, setUserId] = useState<string | null>(null), [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => {
    void (async () => { try { setUserId((await createClient().auth.getSession()).data.session?.user.id ?? null); } catch { setUserId(null); } })();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  const sync = useOfflineSync(business?.id ?? null, userId);
  const load = useCallback(async () => {
    const result = await getExpensesAction().catch(() => null);
    if (result?.success) { setState(result.data); setLoadError(''); setSavedAt(null); return; }
    const snapshot = !online() && business?.id && userId ? await loadSnapshot(business.id, `${userId}:expenses`).catch(() => null) : null;
    if (snapshot) {
      setState({ native: true, accounts: snapshot.items as ExpenseAccount[], banks: snapshot.banks as CollectionAccount[], expenses: [] });
      setSavedAt(snapshot.saved_at); setLoadError('');
    } else setLoadError(result?.error ?? 'Expenses are unavailable. Check your connection and try again.');
  }, [business?.id, userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!state?.native || savedAt || !business?.id || !userId) return;
    void saveSnapshot(business.id, `${userId}:expenses`, { saved_at: new Date().toISOString(), items: state.accounts, banks: state.banks,
      discount_cap: '0', location_id: null }).catch(() => {});
  }, [state, savedAt, business?.id, userId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(form.amount) || Number(form.amount) <= 0) { setError('Enter an amount above zero with at most two decimal places.'); return; }
    const requestKey = key ?? crypto.randomUUID(); setKey(requestKey); setBusy(true); setError(''); setSaved('');
    if (!online()) {
      if (!business?.id || !userId) { setBusy(false); setKey(null); setError('Sign in again when you are back online.'); return; }
      try {
        await keepExpense({ key: requestKey, business_id: business.id, user_id: userId, names: {}, payload: { request_key: requestKey,
          recorded_at: new Date().toISOString(), expense_account_id: form.expense_account_id, amount: form.amount, entry_date: form.entry_date,
          method: form.method, bank_account_id: form.method === 'Transfer' ? form.bank_account_id : null, description: form.description.trim() } });
      } catch { setBusy(false); setKey(null); setError('This phone could not keep the expense. Write it down and record it when you are back online.'); return; }
      setBusy(false); setKey(null); setForm(blank()); setSaved('Expense saved on this phone. It will be sent when you are back online.');
      void sync.refresh();
      return;
    }
    const result = await recordExpenseAction({ request_key: requestKey, expense_account_id: form.expense_account_id, amount: form.amount, entry_date: form.entry_date,
      method: form.method, description: form.description.trim(), ...(form.method === 'Transfer' ? { bank_account_id: form.bank_account_id } : {}) });
    setBusy(false);
    if (result.success) { setKey(null); setForm(blank()); setSaved('Expense recorded.'); await load(); return; }
    if (!result.uncertain) setKey(null);
    setError(result.error);
  }
  const locked = busy || key !== null;
  const set = (name: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [name]: e.target.value }));

  return <div className="space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Expenses</h1><p className="text-muted-foreground">Money paid out of cash or the bank for running the business.</p></div>
    {(!sync.connected || sync.entries.some(e => e.kind === 'expense' && e.user_id === userId)) && <p role="status" className={sync.connected ? 'text-sm' : 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950'}>
      {!sync.connected ? `You are offline. Expenses are kept on this phone and sent when you are back online.${savedAt ? ` Accounts as saved on ${new Date(savedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}.` : ''}`
        : 'Some expenses recorded offline are waiting to send.'} <Link className="underline" href="/settings/offline">Offline sales and expenses</Link></p>}
    {loadError ? <div><p role="alert" className="text-destructive">{loadError}</p><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div>
      : !state ? <p role="status">Loading expenses...</p>
      : !state.native ? <Card><CardContent className="space-y-2 pt-6"><p>Expenses are recorded here once your books are live.</p><p className="text-sm text-muted-foreground">Until then, keep using <Link className="underline" href="/transactions">Transactions</Link>, or <Link className="underline" href="/setup/books">start your books</Link>.</p></CardContent></Card>
      : <>
        {writer && <Card><CardHeader><CardTitle>Record an expense</CardTitle></CardHeader><CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>What was it for?</span><select aria-label="Expense account" required className="w-full rounded-md border bg-background p-2" value={form.expense_account_id} disabled={locked} onChange={set('expense_account_id')}>
              <option value="">Choose an account</option>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>Amount (NGN)</span><Input inputMode="decimal" required value={form.amount} disabled={locked} onChange={set('amount')}/></label>
            <label className="space-y-1 text-sm"><span>Date paid</span><Input type="date" required max={today()} value={form.entry_date} disabled={locked} onChange={set('entry_date')}/></label>
            <label className="space-y-1 text-sm"><span>Paid with</span><select aria-label="Paid with" className="w-full rounded-md border bg-background p-2" value={form.method} disabled={locked} onChange={set('method')}>
              <option value="Cash">Cash</option><option value="Transfer" disabled={!state.banks.length}>Bank transfer</option></select></label>
            {form.method === 'Transfer' && <label className="space-y-1 text-sm"><span>From which bank account?</span><select aria-label="Bank account" required className="w-full rounded-md border bg-background p-2" value={form.bank_account_id} disabled={locked} onChange={set('bank_account_id')}>
              <option value="">Choose a bank account</option>{state.banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
            <label className="space-y-1 text-sm sm:col-span-2"><span>Description</span><Input required maxLength={500} placeholder="For example: diesel for the generator" value={form.description} disabled={locked} onChange={set('description')}/></label>
            <div className="space-y-2 sm:col-span-2">
              {error && <p role="alert" className="text-destructive">{error}</p>}{saved && <p role="status">{saved}</p>}
              {key && !busy && <p className="text-sm">We could not confirm the expense. Retry sends the same request, so it cannot be recorded twice.</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Recording...' : key ? 'Retry' : 'Record expense'}</Button>
            </div>
          </form></CardContent></Card>}
        <PostedEntries title="Recent expenses" entries={state.expenses} canReverse={manager} empty="No expenses recorded yet."
          onReverse={reverseExpenseAction} onReversed={() => void load()}/>
      </>}
  </div>;
}
