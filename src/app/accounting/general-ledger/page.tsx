"use client";
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNgn } from '@/lib/cash-flow';
import type { GeneralLedger } from '@/lib/ledger-reports';
import { getPostingAccountsAction } from '@/app/accounting/journal-entries/actions';
import { getGeneralLedgerAction } from '@/app/accounting/trial-balance/actions';

const today = () => new Date().toLocaleDateString('en-CA');

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState({ account: '', start: `${today().slice(0, 4)}-01-01`, end: today() });
  const [data, setData] = useState<GeneralLedger | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const load = useCallback(async (next: typeof filters, page = 0) => {
    if (!next.account) return;
    setLoading(true); setError('');
    const result = await getGeneralLedgerAction(next.account, next.start, next.end, page);
    if (result.success) setData(result.data); else { setData(null); setError(result.error); }
    setLoading(false);
  }, []);
  useEffect(() => {
    void getPostingAccountsAction().then(setAccounts).catch(() => setError('Accounts unavailable'));
    // Opened from the trial balance with an account and period.
    const query = new URLSearchParams(window.location.search), account = query.get('account');
    if (account) {
      const next = { account, start: query.get('start') || `${today().slice(0, 4)}-01-01`, end: query.get('end') || today() };
      setFilters(next); void load(next);
    }
  }, [load]);
  const shown = data ? { account: data.account.id, start: data.start_date, end: data.end_date } : filters;
  const pages = data ? Math.max(1, Math.ceil(data.total_entries / data.page_size)) : 1;
  return <div className="space-y-6">
    <h1 className="text-3xl font-bold">General Ledger</h1>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void load(filters); }}>
      <label className="space-y-1 text-sm"><span>Account</span><select aria-label="Account" required className="block rounded-md border bg-background p-2" value={filters.account}
        onChange={e => setFilters(f => ({ ...f, account: e.target.value }))}><option value="">Choose an account</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>From</span><Input type="date" required value={filters.start} onChange={e => setFilters(f => ({ ...f, start: e.target.value }))}/></label>
      <label className="space-y-1 text-sm"><span>To</span><Input type="date" required value={filters.end} onChange={e => setFilters(f => ({ ...f, end: e.target.value }))}/></label>
      <Button type="submit" disabled={loading || !filters.account}>{loading ? 'Loading…' : 'Show entries'}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {data && <>
      <div><h2 className="text-lg font-semibold">{data.account.code ? `${data.account.code} ` : ''}{data.account.name}</h2>
        <p className="text-sm text-muted-foreground">{data.tier} · {data.basis} basis · {data.currency} · {data.start_date} to {data.end_date} · generated {data.generated_at.replace('T', ' ')}</p></div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr>{['Date', 'Number', 'Description', 'Other account', 'Debit', 'Credit', 'Balance'].map(h => <th key={h} className={`p-2 ${['Debit', 'Credit', 'Balance'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody>
          <tr className="border-t"><td className="p-2" colSpan={6}>Opening balance</td><td className="p-2 text-right">{formatNgn(data.opening_balance)}</td></tr>
          {data.entries.map((e, i) => <tr key={`${data.page}-${i}`} className="border-t"><td className="p-2">{e.date}</td><td className="p-2">{e.number}</td><td className="p-2">{e.description}</td>
            <td className="p-2">{e.counter_account}</td><td className="p-2 text-right">{e.debit !== '0.00' ? formatNgn(e.debit) : ''}</td>
            <td className="p-2 text-right">{e.credit !== '0.00' ? formatNgn(e.credit) : ''}</td><td className="p-2 text-right">{formatNgn(e.balance)}</td></tr>)}
        </tbody>
        <tfoot><tr className="border-t font-semibold"><td className="p-2" colSpan={4}>Period totals and closing balance</td><td className="p-2 text-right">{formatNgn(data.total_debit)}</td>
          <td className="p-2 text-right">{formatNgn(data.total_credit)}</td><td className="p-2 text-right">{formatNgn(data.closing_balance)}</td></tr></tfoot>
      </table></div>
      {data.total_entries === 0 && <p>No entries in this period.</p>}
      {pages > 1 && <div className="flex items-center gap-2"><Button variant="outline" disabled={loading || data.page === 0} onClick={() => void load(shown, data.page - 1)}>Previous</Button>
        <span className="text-sm">Page {data.page + 1} of {pages}</span>
        <Button variant="outline" disabled={loading || data.page + 1 >= pages} onClick={() => void load(shown, data.page + 1)}>Next</Button></div>}
    </>}
  </div>;
}
