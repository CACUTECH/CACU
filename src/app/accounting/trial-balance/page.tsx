"use client";
import { useState } from 'react';
import { getAccountingSummaryAction } from '@/app/reports/actions';
import { formatNgn } from '@/lib/cash-flow';
import type { AccountingSummary } from '@/lib/accounting-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function TrialBalancePage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AccountingSummary | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setData(null); setError('');
    const result = await getAccountingSummaryAction(`${date.slice(0, 4)}-01-01`, date);
    if (result.success) setData(result.data); else setError(result.error);
    setLoading(false);
  }
  return <div className="space-y-6"><h1 className="text-3xl font-bold">Trial Balance</h1>
    <label>As of date<Input type="date" value={date} onChange={event => { setDate(event.target.value); setData(null); }} /></label>
    <Button disabled={loading || !date} onClick={() => void load()}>{loading ? 'Loading…' : 'Run report'}</Button>
    {error && <p role="alert">{error}</p>}
    {data && <><table className="w-full"><thead><tr><th className="text-left">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>
      {data.trial_balance.map(row => <tr key={row.account_id}><td className="py-2">{row.name}</td><td className="text-right">{formatNgn(row.debit)}</td><td className="text-right">{formatNgn(row.credit)}</td></tr>)}
    </tbody></table>{data.trial_balance.length === 0 && <p>No posted balances as of this date.</p>}
    <p role={data.trial_balance_difference !== '0.00' ? 'alert' : undefined}>Difference: {formatNgn(data.trial_balance_difference)}</p></>}
  </div>;
}
