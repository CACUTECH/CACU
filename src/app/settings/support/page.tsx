"use client";
// Settings › Support access (Doc 10 E22 part 4, FR-212): CACU staff cannot see a business unless its Owner lets them,
// for one support case, for a set time. Read-only; staff and pay records only if ticked. Every opening is listed here.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { endSupportAction, grantSupportAction, supportStatusAction } from '@/app/settings/support/actions';
import { dateTime, SUPPORT_LENGTHS, type SupportStatus } from '@/lib/support-access';

const EVENT = { granted: 'Access granted', opened: 'Opened by', ended: 'Access ended' } as const;

export default function SupportAccessPage() {
  const [status, setStatus] = React.useState<SupportStatus | null | undefined>(undefined);
  const [refusal, setRefusal] = React.useState('');
  const [hours, setHours] = React.useState(24), [reason, setReason] = React.useState(''), [pay, setPay] = React.useState(false);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  React.useEffect(() => {
    void supportStatusAction().then(r => { if (r.success) setStatus(r.data); else { setStatus(null); setRefusal(r.error); } });
  }, []);

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) { setError('Say briefly what support should look at.'); return; }
    setBusy(true); setError('');
    const r = await grantSupportAction(hours, reason.trim(), pay);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setStatus(r.data); setReason(''); setPay(false);
  };
  const end = async () => {
    setBusy(true); setError('');
    const r = await endSupportAction();
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setStatus(r.data);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Support access</h1>
    <p className="text-muted-foreground">CACU support cannot see your business unless you let them, for one problem at a time.</p></div>;
  if (status === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (status === null) return <div className="space-y-4">{heading}<p>{refusal}</p></div>;

  const active = status.active;
  return <div className="max-w-2xl space-y-6">{heading}
    {active ? <section aria-label="Support has access" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="font-medium">CACU support can look at your business until {dateTime(active.expires_at)}.</p>
      <p className="text-sm">For: {active.reason}. Read-only. {active.include_pay ? 'Staff and pay records included.' : 'Staff and pay records hidden.'}</p>
      <Button type="button" variant="destructive" disabled={busy} onClick={() => void end()}>{busy ? 'Ending…' : 'End access now'}</Button>
    </section>
    : <form onSubmit={e => void grant(e)} className="space-y-4 rounded-xl border p-4">
      <h2 className="font-semibold">Let CACU support look</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Support can see your records but cannot change anything.</li>
        <li>Access ends by itself at the time you choose, and you can end it sooner.</li>
        <li>Each time someone from support opens your business, it is listed below.</li>
      </ul>
      <div className="space-y-1"><Label htmlFor="support-reason">What should support look at?</Label>
        <Input id="support-reason" value={reason} maxLength={300} disabled={busy} onChange={e => setReason(e.target.value)} /></div>
      <fieldset className="space-y-1"><legend className="text-sm font-medium">For how long?</legend>
        <div className="flex flex-wrap gap-2">{SUPPORT_LENGTHS.map(l =>
          <label key={l.hours} className="flex items-center gap-1 rounded-md border px-3 py-1 text-sm">
            <input type="radio" name="support-length" checked={hours === l.hours} disabled={busy} onChange={() => setHours(l.hours)} />{l.label}
          </label>)}</div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={pay} disabled={busy} onChange={e => setPay(e.target.checked)} />
        <span>Include staff and pay records (salaries, payroll and staff bank details). Only tick this for a payroll problem.</span>
      </label>
      <Button type="submit" disabled={busy}>{busy ? 'Granting…' : 'Grant access'}</Button>
    </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <section aria-label="Support history" className="space-y-2">
      <h2 className="font-semibold">History</h2>
      {status.history.length === 0 ? <p className="text-sm text-muted-foreground">CACU support has never had access to this business.</p> :
        <ul className="divide-y rounded-xl border text-sm">{status.history.map((h, i) =>
          <li key={i} className="p-3"><span className="font-medium">{EVENT[h.event]}{h.event === 'opened' ? ` ${h.by}` : ''}</span>
            {' · '}{dateTime(h.at)}<div className="text-muted-foreground">{h.reason}</div></li>)}</ul>}
    </section>
  </div>;
}
