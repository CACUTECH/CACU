"use client";
// Settings › Close business (Doc 10 E22 part 3, FR-210): the Owner closes the business, typing its name. It becomes
// read-only at once; staff lose access; the Owner can export everything or reopen it for 90 days. After that, customer
// and supplier contact details and operational data are removed; the books are kept as the law requires.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOptionalBusiness } from '@/components/business-provider';
import { closeBusinessAction, closureStatusAction, reopenBusinessAction } from '@/app/settings/close/actions';
import { longDate, type ClosureStatus } from '@/lib/closure';

export default function CloseBusinessPage() {
  const name = (useOptionalBusiness()?.business?.name as string | undefined) ?? '';
  const [status, setStatus] = React.useState<ClosureStatus | null | undefined>(undefined);
  const [typed, setTyped] = React.useState(''), [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  React.useEffect(() => { void closureStatusAction().then(r => setStatus(r.success ? r.data : null)); }, []);

  const close = async (event: React.FormEvent) => {
    event.preventDefault();
    if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) { setError('Type the business name exactly as it appears in your settings.'); return; }
    if (reason.trim().length < 3) { setError('Say briefly why you are closing the business.'); return; }
    setBusy(true); setError('');
    const r = await closeBusinessAction(typed, reason.trim());
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setStatus(r.data); setMessage(`The business is closed. Export your data or reopen it before ${longDate(r.data.purge_after)}.`);
  };
  const reopen = async () => {
    setBusy(true); setError('');
    const r = await reopenBusinessAction();
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setStatus(r.data); setMessage(`The business is open again.${r.data.staff_restored ? ` ${r.data.staff_restored} staff member${r.data.staff_restored === 1 ? ' has' : 's have'} their access back.` : ''}`);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Close business</h1>
    <p className="text-muted-foreground">For when you stop trading or no longer want CACU to keep this business.</p></div>;
  if (status === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (status && !status.is_owner) return <div className="space-y-4">{heading}<p>Only the business owner can close the business.</p></div>;

  return <div className="max-w-2xl space-y-6">{heading}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {status?.closed ? <section className="space-y-3 rounded-xl border p-4" aria-label="Closed">
      <p className="font-medium">Closed on {longDate(status.closed_at)}. Everything is read-only.</p>
      <p>Until {longDate(status.purge_after)} you can <Link className="underline" href="/settings/export">export your data</Link> or reopen the business. After that, customer and supplier contact details are removed; your books stay, read-only.</p>
      {status.can_reopen && <Button type="button" disabled={busy} onClick={() => void reopen()}>{busy ? 'Reopening…' : 'Reopen the business'}</Button>}
    </section>
    : <form onSubmit={e => void close(e)} className="space-y-4 rounded-xl border border-destructive/40 p-4">
      <h2 className="font-semibold">What closing does</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Everything becomes read-only at once: no new sales, invoices, expenses or stock changes.</li>
        <li>Your staff ({status?.staff ?? 0}) lose access. Pay links stop working, and CACU stops billing you.</li>
        <li>For 90 days you can still see and <Link className="underline" href="/settings/export">export everything</Link>, and reopen the business, which brings your staff back.</li>
        <li>After 90 days, customer and supplier phone numbers, emails and addresses, message logs and similar records are removed for good.</li>
        <li>Your books (sales, invoices, payments, payroll) are kept, read-only, for six years after the year you close, as tax and company law require. You can still read them.</li>
      </ul>
      <p className="text-sm">Export your data first if you want a copy.</p>
      <div className="space-y-1"><Label htmlFor="close-reason">Why are you closing?</Label>
        <Input id="close-reason" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="close-name">Type <span className="font-semibold">{name}</span> to confirm</Label>
        <Input id="close-name" value={typed} autoComplete="off" disabled={busy} onChange={e => setTyped(e.target.value)} /></div>
      <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Closing…' : 'Close the business'}</Button>
    </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
