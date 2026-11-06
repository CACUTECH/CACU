"use client";
// Deposits and cancellations (Doc 10 services rules, PR-12): a deposit per service, the free-cancellation window and
// what a late cancellation or no-show does with the deposit. Owners and Admins change them; the first deposit adds
// Customer deposits and advances to the chart.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { getBookingSettingsAction, saveBookingSettingsAction } from '../actions';
import { expectedDepositKobo, type BookingSettings, type Service } from '@/lib/bookings';
import { nairaText } from '@/lib/checkout';

type Rule = { kind: 'none' | 'fixed' | 'percent'; value: string };

export default function BookingSettingsPage() {
  const [supabase] = React.useState(() => createClient());
  const [saved, setSaved] = React.useState<BookingSettings | null | undefined>(undefined);
  const [services, setServices] = React.useState<Service[]>([]);
  const [hours, setHours] = React.useState('24'), [late, setLate] = React.useState<'keep' | 'refund'>('keep');
  const [rules, setRules] = React.useState<Record<string, Rule>>({});
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const id = await getActiveBusinessIdAction();
      const [settings, items] = await Promise.all([getBookingSettingsAction(),
        supabase.from('catalog_items').select('id, name, duration, unit_price').eq('business_id', id).eq('item_type', 'SERVICE').eq('is_active', true).order('name')]);
      if (!live) return;
      if (!settings.success) { setError(settings.error); return; }
      setSaved(settings.data);
      setServices((items.data as Service[] | null) ?? []);
      if (settings.data) {
        setHours(String(settings.data.free_cancel_hours)); setLate(settings.data.late_deposit);
        setRules(Object.fromEntries(settings.data.rules.map(r => [r.service_id, { kind: r.kind, value: String(Number(r.value)) }])));
      }
    })().catch(() => { if (live) setError('Booking settings are unavailable. Refresh to try again.'); });
    return () => { live = false; };
  }, [supabase]);

  const rule = (id: string): Rule => rules[id] ?? { kind: 'none', value: '' };
  const setRule = (id: string, next: Partial<Rule>) => setRules(r => ({ ...r, [id]: { ...rule(id), ...next } }));
  const badRule = services.find(s => {
    const r = rule(s.id);
    if (r.kind === 'none') return false;
    const v = Number(r.value);
    return !/^\d{1,13}(\.\d{1,2})?$/.test(r.value.trim()) || v <= 0 || (r.kind === 'percent' && v > 100);
  });
  const problem = !/^\d{1,3}$/.test(hours) || Number(hours) > 720 ? 'Enter the free-cancellation window in whole hours, up to 720.'
    : badRule ? `Enter a deposit above zero for ${badRule.name}${rule(badRule.id).kind === 'percent' ? ', at most 100%' : ''}.` : '';

  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    const result = await saveBookingSettingsAction({ freeCancelHours: Number(hours), lateDeposit: late,
      rules: services.map(s => ({ serviceId: s.id, kind: rule(s.id).kind, value: rule(s.id).value.trim() || '0' })) });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setSaved(result.data);
    setMessage(result.data.rules.length && !saved?.deposits_ready
      ? 'Saved. Customer deposits and advances was added to your chart of accounts to hold deposits.' : 'Saved.');
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Deposits and cancellations</h1>
    <p className="text-muted-foreground">Ask for a deposit when customers book, and decide what happens when they cancel late or don&apos;t come.</p></div>;
  if (saved === null) return <div className="space-y-2">{heading}<p role="status">Deposits are available once your books are turned on.</p></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">{heading}
      <Button asChild variant="outline"><Link href="/appointments">Back to appointments</Link></Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {saved === undefined && !error && <p role="status">Loading…</p>}
    {saved && <>
      <Card><CardHeader><CardTitle>Cancellations</CardTitle>
        <CardDescription>Cancelling earlier than this refunds the deposit. Later, and no-shows, follow your choice below.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex flex-wrap items-center gap-2"><span>Free cancellation up to</span>
            <Input aria-label="Free cancellation hours" inputMode="numeric" className="h-9 w-20" value={hours} disabled={busy} onChange={e => setHours(e.target.value)} />
            <span>hours before the booking</span></label>
          <div role="radiogroup" aria-label="Late cancellation or no-show" className="flex flex-wrap gap-2">
            {(['keep', 'refund'] as const).map(v => <Button key={v} type="button" role="radio" aria-checked={late === v} disabled={busy}
              variant={late === v ? 'default' : 'outline'} onClick={() => setLate(v)}>{v === 'keep' ? 'Keep the deposit as income' : 'Refund the deposit'}</Button>)}
          </div>
          <p className="text-muted-foreground">Someone who can approve sales can still choose the other way for a booking.</p>
        </CardContent></Card>
      <Card><CardHeader><CardTitle>Deposit per service</CardTitle>
        <CardDescription>{services.length === 0 ? 'Add services in the catalogue first.' : 'A fixed amount, or a percentage of the price.'}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {services.map(s => {
            const r = rule(s.id);
            const due = r.kind === 'none' ? 0 : expectedDepositKobo({ kind: r.kind, value: r.value || '0' }, Number(s.unit_price));
            return <div key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="w-48 font-medium">{s.name} <span className="font-normal text-muted-foreground">({nairaText(Math.round(Number(s.unit_price) * 100))})</span></span>
              <select aria-label={`Deposit for ${s.name}`} className="h-9 rounded-md border bg-background px-2" value={r.kind} disabled={busy}
                onChange={e => setRule(s.id, { kind: e.target.value as Rule['kind'] })}>
                <option value="none">No deposit</option><option value="fixed">Fixed amount</option><option value="percent">Percentage</option>
              </select>
              {r.kind !== 'none' && <>
                <Input aria-label={`${s.name} deposit ${r.kind === 'percent' ? '(%)' : '(₦)'}`} inputMode="decimal" className="h-9 w-28" value={r.value} disabled={busy}
                  onChange={e => setRule(s.id, { value: e.target.value })} />
                <span>{r.kind === 'percent' ? '%' : '₦'}</span>
                {due > 0 && <span className="text-muted-foreground">= {nairaText(due)}</span>}
              </>}
            </div>;
          })}
        </CardContent></Card>
      {problem && <p role="alert" className="text-destructive">{problem}</p>}
      <Button disabled={busy || !!problem} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
    </>}
  </div>;
}
