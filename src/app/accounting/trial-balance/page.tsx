"use client";
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNgn } from '@/lib/cash-flow';
import type { TrialBalance } from '@/lib/ledger-reports';
import { getTrialBalanceAction } from '@/app/accounting/trial-balance/actions';

const today = () => new Date().toLocaleDateString('en-CA');

export default function TrialBalancePage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<TrialBalance | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setData(null); setError('');
    const result = await getTrialBalanceAction(date);
    if (result.success) setData(result.data); else setError(result.error);
    setLoading(false);
  }
  const yearStart = `${date.slice(0, 4)}-01-01`;
  return <div className="space-y-6">
    <h1 className="text-3xl font-bold">Trial Balance</h1>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm"><span>As of date</span><Input type="date" value={date} onChange={event => { setDate(event.target.value); setData(null); }} /></label>
      <Button disabled={loading || !date} onClick={() => void load()}>{loading ? 'Loading…' : 'Run report'}</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">{data.tier} · {data.basis} basis · {data.currency} · as of {data.as_of} · generated {data.generated_at.replace('T', ' ')}</p>
      {data.exceptions.length > 0 && <div role="alert" className="space-y-1 rounded-md border border-destructive p-3">
        <p className="font-medium text-destructive">These figures do not reconcile. Check them before relying on this report.</p>
        <ul className="list-disc pl-5 text-sm">{data.exceptions.map(e => <li key={e.check}>{e.message}</li>)}</ul>
      </div>}
      {!data.controls_checked && <p className="text-sm">Customer, supplier and stock balances are checked only on a report up to today.</p>}
      {data.lines.length === 0 ? <p>No posted balances as of this date.</p> : <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th className="p-2 text-left">Account</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2" /></tr></thead>
        <tbody>{data.lines.map(row => <tr key={row.account_id} className="border-t">
          <td className="p-2">{row.code ? `${row.code} ` : ''}{row.name}</td>
          <td className="p-2 text-right">{row.debit !== '0.00' ? formatNgn(row.debit) : ''}</td>
          <td className="p-2 text-right">{row.credit !== '0.00' ? formatNgn(row.credit) : ''}</td>
          <td className="p-2 text-right"><Link className="underline" href={`/accounting/general-ledger?${new URLSearchParams({ account: row.account_id, start: yearStart, end: data.as_of })}`}>Entries</Link></td>
        </tr>)}</tbody>
        <tfoot><tr className="border-t font-semibold"><td className="p-2">Total</td><td className="p-2 text-right">{formatNgn(data.total_debit)}</td><td className="p-2 text-right">{formatNgn(data.total_credit)}</td><td /></tr></tfoot>
      </table></div>}
    </>}
  </div>;
}
