"use client";
// Settings › Notifications (Doc 10 E20): reminders the business sends its customers, this month's text allowance and the
// latest messages. Addresses are shown masked.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/components/business-provider';
import { rpc, type NotificationOverview } from '@/lib/customer-messages';

const KIND: Record<string, string> = { receipt: 'Receipt', invoice_reminder: 'Invoice reminder', booking_confirmation: 'Booking confirmation', booking_reminder: 'Booking reminder' };
const STATUS: Record<string, string> = { queued: 'Waiting to send', sending: 'Sending', sent: 'Sent', failed: 'Not sent yet', skipped: 'Not sent' };

export default function NotificationsPage() {
  const { business } = useBusiness();
  const [overview, setOverview] = React.useState<NotificationOverview | null>(null);
  const [draft, setDraft] = React.useState({ invoice: false, booking: false });
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!business?.id) return;
    let live = true;
    void rpc<NotificationOverview>('notification_overview', { p_business_id: business.id }).then(r => {
      if (!live) return;
      if (r.success) { setOverview(r.data); setDraft({ invoice: r.data.invoice_reminders, booking: r.data.booking_reminders }); } else setError(r.error);
    });
    return () => { live = false; };
  }, [business?.id]);

  const save = async () => {
    if (!business?.id) return;
    setBusy(true); setMessage('');
    const r = await rpc<NotificationOverview>('save_notification_settings', { p_business_id: business.id, p_invoice_reminders: draft.invoice, p_booking_reminders: draft.booking });
    setBusy(false);
    if (r.success) { setOverview(r.data); setMessage('Saved.'); } else setError(r.error);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Notifications</h1>
    <p className="text-muted-foreground">Messages your business sends its customers by email and text.</p></div>;
  if (error && !overview) return <div className="space-y-4">{heading}<p role="alert" className="text-destructive">{error}</p></div>;
  if (!overview) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  const changed = draft.invoice !== overview.invoice_reminders || draft.booking !== overview.booking_reminders;
  const resets = new Date(overview.texts.resets_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' });

  return <div className="max-w-2xl space-y-6">{heading}
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Reminders</h2>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={draft.invoice} disabled={!overview.can_edit || busy}
        onChange={e => setDraft(d => ({ ...d, invoice: e.target.checked }))} />
        <span><span className="font-medium">Overdue invoice reminders</span>
          <span className="block text-sm text-muted-foreground">To customers with an unpaid invoice: the day before it is due, on the due date, and 7 days after, until it is paid.</span></span></label>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={draft.booking} disabled={!overview.can_edit || busy || !overview.booking_allowed}
        onChange={e => setDraft(d => ({ ...d, booking: e.target.checked }))} />
        <span><span className="font-medium">Booking messages</span>
          <span className="block text-sm text-muted-foreground">A confirmation when a booking is made, and a reminder the day before.</span>
          {!overview.booking_allowed && <span className="block text-sm text-amber-700">Booking messages come with the Oga and Chairman plans.</span>}</span></label>
      <p className="text-sm text-muted-foreground">Messages go by text when the customer has a phone number and texts are left this month, otherwise by email.</p>
      {overview.can_edit ? <Button disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        : <p className="text-sm">Only people who can change settings can turn reminders on or off.</p>}
      {message && <p role="status" className="text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
    <section className="space-y-2 rounded-xl border p-4">
      <h2 className="font-semibold">Texts this month</h2>
      <p><span className="text-2xl font-bold">{overview.texts.used}</span> of {overview.texts.limit} used</p>
      <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden><div className="h-full bg-primary" style={{ width: `${Math.min(100, overview.texts.used * 100 / Math.max(overview.texts.limit, 1))}%` }} /></div>
      <p className="text-sm text-muted-foreground">Your plan includes {overview.texts.limit} texts a month; the count starts again on {resets}. Emails are not limited. When texts run out, messages go by email.</p>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">Latest messages</h2>
      {overview.recent.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet. Send a receipt from the till to start.</p>
        : <ul className="divide-y rounded-xl border text-sm">{overview.recent.map((m, i) => <li key={i} className="flex flex-wrap justify-between gap-2 p-3">
          <span>{KIND[m.kind] ?? m.kind} by {m.channel === 'sms' ? 'text' : 'email'} to {m.to}</span>
          <span className="text-muted-foreground">{STATUS[m.status] ?? m.status}, {new Date(m.created_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}</span>
        </li>)}</ul>}
    </section>
  </div>;
}
