"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBusiness } from '@/components/business-provider';
import { CloseShiftDialog } from '@/components/shift-bar';
import { getShiftAction, listShiftsAction, saveShiftPolicyAction } from '@/app/pos/shift-actions';
import { lagosToday, naira } from '@/lib/transfers';
import { differenceText, openedAt, type Shift, type ShiftStatus } from '@/lib/shifts';

/** Doc 10 shifts: the day's shifts with their counts and differences, every shift still open, and the owner's rule. */
export default function ShiftsPage() {
  const { business } = useBusiness();
  const owner = business?.userRole === 'owner';
  const [day, setDay] = useState(lagosToday());
  const [status, setStatus] = useState<ShiftStatus | null | undefined>(undefined);
  const [shifts, setShifts] = useState<Shift[] | null | undefined>(undefined), [error, setError] = useState('');
  const [closing, setClosing] = useState<Shift | null>(null), [message, setMessage] = useState(''), [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setError(''); setShifts(undefined);
    void Promise.all([getShiftAction(), listShiftsAction(day)]).then(([mine, list]) => {
      if (!live) return;
      if (mine.success) setStatus(mine.data); else setError(mine.error);
      if (list.success) setShifts(list.data); else setError(list.error);
    });
    return () => { live = false; };
  }, [day, version]);

  const requireShift = async (value: boolean) => {
    setSaving(true); setMessage('');
    const result = await saveShiftPolicyAction(value);
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    setMessage(result.data.require_shift ? 'Everyone now needs an open shift to sell.' : 'Shifts are now optional.');
    setVersion(v => v + 1);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Shifts</h1>
    <p className="text-muted-foreground">Each cashier&apos;s float, the cash their sales brought in, and the count when they closed.</p></div>;
  if (status === null || shifts === null) return <div className="space-y-2">{heading}<p role="status">Shifts are available once your books are turned on.</p></div>;
  if (status && !status.available) return <div className="space-y-2">{heading}
    <p role="status">Cashier shifts come with the Oga and Chairman plans. <Link className="underline" href="/settings/billing">See plans in Billing</Link>.</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      {heading}
      <div className="flex flex-wrap items-end gap-2">
        <Button asChild variant="outline"><Link href="/pos">Back to till</Link></Button>
        <label className="space-y-1 text-sm"><span>Day</span><Input type="date" value={day} max={lagosToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
      </div>
    </div>
    {owner && status && <div className="rounded border p-3 text-sm flex flex-wrap items-center justify-between gap-3">
      <p>{status.require_shift ? 'Everyone must open a shift before selling.' : 'Shifts are optional: people can sell without one.'}</p>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => void requireShift(!status.require_shift)}>
        {status.require_shift ? 'Make shifts optional' : 'Require a shift to sell'}</Button>
    </div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {shifts === undefined && !error && <p role="status">Loading…</p>}
    {shifts && shifts.length === 0 && <p className="text-muted-foreground">No shifts on this day.</p>}
    {shifts && shifts.length > 0 && <div className="overflow-x-auto rounded border">
      <table className="w-full text-left text-sm">
        <thead><tr>{['Cashier', 'Opened', 'Float', 'Sales', 'Expected cash', 'Counted', 'Difference', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{shifts.map(s => <tr key={s.id} className="border-t align-top">
          <td className="p-2 font-medium">{s.mine ? 'You' : s.opened_by_name}</td>
          <td className="p-2">{s.opened_on === day ? openedAt(s) : `${s.opened_on}, ${openedAt(s)}`}
            {s.overdue && <Badge variant="destructive" className="ml-2">Open past midnight</Badge>}</td>
          <td className="p-2">{naira(s.opening_float)}</td>
          <td className="p-2">{s.sales}<span className="block text-xs text-muted-foreground">{naira(s.cash_sales)} cash</span></td>
          <td className="p-2">{naira(s.expected_cash)}</td>
          <td className="p-2">{s.counted_cash === null ? <Badge variant="outline">Open</Badge> : naira(s.counted_cash)}</td>
          <td className="p-2">{s.variance === null ? '' : <span className={Number(s.variance) === 0 ? '' : 'font-semibold text-amber-700'}>{differenceText(s.variance)}</span>}
            {s.close_note && <span className="block text-xs text-muted-foreground">{s.close_note}</span>}</td>
          <td className="p-2">{s.status === 'open' && (s.mine || status?.can_manage) &&
            <Button size="sm" variant="outline" onClick={() => { setMessage(''); setClosing(s); }}>Close</Button>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {closing && <CloseShiftDialog key={closing.id} shift={closing} open onClose={() => setClosing(null)}
      onDone={s => { setClosing(null); setMessage(`Shift closed. ${differenceText(s.variance ?? '0')}.`); setVersion(v => v + 1); }} />}
  </div>;
}
