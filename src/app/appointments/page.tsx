"use client";
// Bookings day view (Doc 10 services, bookings and jobs rules; Doc 12 SCR-15). Each staff member's bookings for the
// day, a new-booking dialog that offers only free times, and the booking's next step. The database enforces every
// rule (no overlaps, working hours, time off, the booking states); this screen only avoids offering what it refuses.
// Once the books are on, bookings can hold a deposit (PR-12); cancelling or marking no-show then goes through the
// accounting API so the deposit is settled with the booking.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { billByInvoiceAction, closeBookingAction, getBookingMoneyAction, takeDepositAction } from './actions';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { formatKobo, kobo, nairaText } from '@/lib/checkout';
import { lagosToday, naira } from '@/lib/transfers';
import {
  DEPOSIT_LABELS, STATUS_LABELS, addDays, bookingError, expectedDepositKobo, freeSlots, freeToCancel, lagosDay, lagosInstant, lagosTime, serviceMinutes,
  type Booking, type BookingSettings, type Deposit, type Hours, type Service, type Staff, type StaffService, type TimeOff,
} from '@/lib/bookings';

type Customer = { id: string; name: string };
type Bank = { id: string; name: string };
type Data = { staff: Staff[]; services: Service[]; links: StaffService[]; hours: Hours[]; timeOff: TimeOff[]; bookings: Booking[]; customers: Customer[] };
type Money = { settings: BookingSettings; deposits: Deposit[] };
const BOOKING_COLUMNS = 'id, staff_id, service_id, scheduled_at, ends_at, duration_minutes, title, status, customer_id, customer_name, customer_phone, notes, cancel_reason, bill_kind';
const OPEN = ['awaiting_transfer', 'held'];

export default function AppointmentsPage() {
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [day, setDay] = React.useState(lagosToday());
  const [data, setData] = React.useState<Data | null>(null);
  const [money, setMoney] = React.useState<Money | null>(null);
  const [banks, setBanks] = React.useState<Bank[]>([]);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [editing, setEditing] = React.useState<{ booking?: Booking } | null>(null);
  const [closing, setClosing] = React.useState<{ booking: Booking; how: 'cancel' | 'no-show' } | null>(null);
  const [paying, setPaying] = React.useState<Booking | null>(null);
  const [invoicing, setInvoicing] = React.useState<Booking | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const id = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(id);
        // A day's bookings, plus a day either side so the free times account for anything crossing midnight.
        const from = lagosInstant(addDays(day, -1), '00:00'), to = lagosInstant(addDays(day, 2), '00:00');
        const [staff, services, links, hours, timeOff, bookings, customers, deposits, accounts] = await Promise.all([
          supabase.from('service_staff').select('id, name, is_active').eq('business_id', id).order('name'),
          supabase.from('catalog_items').select('id, name, duration, unit_price').eq('business_id', id).eq('item_type', 'SERVICE').eq('is_active', true).order('name'),
          supabase.from('service_staff_services').select('staff_id, service_id').eq('business_id', id),
          supabase.from('service_staff_hours').select('staff_id, weekday, starts, ends').eq('business_id', id),
          supabase.from('service_staff_time_off').select('id, staff_id, starts_at, ends_at, reason').eq('business_id', id).gte('ends_at', from).lte('starts_at', to),
          supabase.from('appointments').select(BOOKING_COLUMNS).eq('business_id', id).gte('scheduled_at', from).lt('scheduled_at', to).order('scheduled_at'),
          supabase.from('customers').select('id, name').eq('business_id', id).order('name').limit(500),
          getBookingMoneyAction(addDays(day, -1), addDays(day, 1)),
          getCollectionAccountsAction().catch(() => ({ native: false, accounts: [] })),
        ]);
        if (!live) return;
        const failed = [staff, services, links, hours, timeOff, bookings].find(r => r.error);
        if (failed) { setError('Bookings are unavailable. You may not have access to services. Refresh to try again.'); return; }
        setError('');
        setData({ staff: staff.data as Staff[], services: services.data as Service[], links: links.data as StaffService[], hours: hours.data as Hours[],
          timeOff: timeOff.data as TimeOff[], bookings: bookings.data as Booking[], customers: (customers.data as Customer[] | null) ?? [] });
        setMoney(deposits.success ? deposits.data : null);
        setBanks(accounts.accounts);
      } catch { if (live) setError('Bookings are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, day, version]);

  const refresh = (text: string) => { setMessage(text); setError(''); setVersion(v => v + 1); };

  // Check-in and completion through the Data API. Row security hides the change from people without services.edit,
  // so an empty result means they were not allowed.
  const advance = async (booking: Booking, status: Booking['status'], extra: Record<string, string> = {}) => {
    setMessage('');
    const { data: rows, error: failed } = await supabase.from('appointments').update({ status, ...extra }).eq('id', booking.id).select('id');
    if (failed) { setError(bookingError(failed)); return false; }
    if (!rows?.length) { setError('You do not have permission to change bookings. Ask the business owner.'); return false; }
    refresh(`${booking.customer_name || 'Booking'}: ${STATUS_LABELS[status].toLowerCase()}.`);
    return true;
  };

  const services = new Map((data?.services ?? []).map(s => [s.id, s]));
  const customers = new Map((data?.customers ?? []).map(c => [c.id, c.name]));
  const todays = (data?.bookings ?? []).filter(b => lagosDay(b.scheduled_at) === day);
  const shown = (data?.staff ?? []).filter(s => s.is_active || todays.some(b => b.staff_id === s.id));
  const depositOf = (b: Booking) => money?.deposits.find(d => d.appointment_id === b.id && OPEN.includes(d.status))
    ?? money?.deposits.find(d => d.appointment_id === b.id);
  const dueKobo = (b: Booking) => {
    const service = services.get(b.service_id);
    return service ? expectedDepositKobo(money?.settings.rules.find(r => r.service_id === b.service_id), Number(service.unit_price)) : 0;
  };
  const [now] = React.useState(() => Date.now());

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Appointments</h1>
        <p className="text-muted-foreground">Each staff member&apos;s bookings for the day. Times are Lagos time.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" aria-label="Previous day" onClick={() => setDay(d => addDays(d, -1))}>‹</Button>
        <label className="space-y-1 text-sm"><span>Day</span><Input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} /></label>
        <Button variant="outline" aria-label="Next day" onClick={() => setDay(d => addDays(d, 1))}>›</Button>
        <Button asChild variant="outline"><Link href="/appointments/staff">Staff and hours</Link></Button>
        {money && <Button asChild variant="outline"><Link href="/appointments/settings">Deposits and cancellations</Link></Button>}
        <Button disabled={!data || data.staff.length === 0} onClick={() => { setMessage(''); setEditing({}); }}>New booking</Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data && !error && <p role="status">Loading…</p>}
    {data && data.staff.length === 0 && <Card><CardContent className="pt-6 space-y-2">
      <p>Add the people customers book, and the services each one does, before taking bookings.</p>
      <Button asChild><Link href="/appointments/staff">Add staff</Link></Button>
    </CardContent></Card>}
    {data && data.staff.length > 0 && data.services.length === 0 && <p className="text-sm text-muted-foreground">
      Add your services in the catalogue (type Service, with estimated minutes) to book them.</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {shown.map(person => {
        const mine = todays.filter(b => b.staff_id === person.id);
        return <Card key={person.id}>
          <CardHeader className="pb-3"><CardTitle className="text-lg">{person.name}</CardTitle>
            <CardDescription>{mine.filter(b => b.status !== 'cancelled' && b.status !== 'no_show').length} bookings{person.is_active ? '' : ' (no longer works here)'}</CardDescription></CardHeader>
          <CardContent>
            {mine.length === 0 ? <p className="text-sm text-muted-foreground">Nothing booked.</p> : <ul className="space-y-2 text-sm" aria-label={`${person.name}'s bookings`}>
              {mine.map(b => {
                const closed = b.status === 'cancelled' || b.status === 'no_show';
                const deposit = depositOf(b);
                const due = dueKobo(b);
                const canPay = money?.settings.deposits_ready && ['confirmed', 'checked_in'].includes(b.status) && !(deposit && OPEN.includes(deposit.status));
                return <li key={b.id} className={`rounded border p-2 ${closed ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{lagosTime(b.scheduled_at)}–{lagosTime(b.ends_at)} {services.get(b.service_id)?.name ?? b.title}</span>
                    <Badge variant={closed ? 'outline' : b.status === 'completed' ? 'secondary' : 'default'}>{STATUS_LABELS[b.status]}</Badge>
                  </div>
                  <p>{(b.customer_id && customers.get(b.customer_id)) || b.customer_name || 'Customer'}{b.customer_phone ? `, ${b.customer_phone}` : ''}</p>
                  {b.notes && <p className="text-muted-foreground">{b.notes}</p>}
                  {b.cancel_reason && <p className="text-muted-foreground">Cancelled: {b.cancel_reason}</p>}
                  {deposit ? <p>Deposit {naira(deposit.amount)} {deposit.method === 'cash' ? 'in cash' : 'by transfer'}: {DEPOSIT_LABELS[deposit.status]}</p>
                    : canPay && due > 0 && <p className="text-muted-foreground">Deposit due: {nairaText(due)}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {b.status === 'confirmed' && <>
                      <Button size="sm" onClick={() => void advance(b, 'checked_in')}>Check in</Button>
                      <Button size="sm" variant="outline" onClick={() => { setMessage(''); setEditing({ booking: b }); }}>Reschedule</Button>
                      <Button size="sm" variant="outline" onClick={() => { setMessage(''); setClosing({ booking: b, how: 'cancel' }); }}>Cancel</Button>
                      {new Date(b.scheduled_at).getTime() <= now && <Button size="sm" variant="outline" onClick={() => { setMessage(''); setClosing({ booking: b, how: 'no-show' }); }}>No-show</Button>}
                    </>}
                    {b.status === 'checked_in' && <Button size="sm" onClick={() => void advance(b, 'completed')}>Complete</Button>}
                    {b.status === 'completed' && money && !b.bill_kind && <>
                      <Button asChild size="sm"><Link href={`/pos?booking=${b.id}`}>Take payment</Link></Button>
                      <Button size="sm" variant="outline" onClick={() => { setMessage(''); setInvoicing(b); }}>Bill by invoice</Button>
                    </>}
                    {b.bill_kind && <Badge variant="secondary">{b.bill_kind === 'sale' ? 'Paid at the till' : 'Invoiced'}</Badge>}
                    {canPay && <Button size="sm" variant="outline" onClick={() => { setMessage(''); setPaying(b); }}>Take deposit</Button>}
                  </div>
                </li>;
              })}
            </ul>}
          </CardContent>
        </Card>;
      })}
    </div>
    {editing && data && businessId && <BookingDialog key={editing.booking?.id ?? 'new'} data={data} businessId={businessId} day={day} booking={editing.booking}
      onClose={() => setEditing(null)} onDone={text => { setEditing(null); refresh(text); }} />}
    {invoicing && <InvoiceDialog booking={invoicing} customers={data?.customers ?? []} onClose={() => setInvoicing(null)}
      onDone={text => { setInvoicing(null); refresh(text); }} />}
    {paying && <DepositDialog booking={paying} banks={banks} dueKobo={dueKobo(paying)} onClose={() => setPaying(null)}
      onDone={text => { setPaying(null); refresh(text); }} />}
    {closing && <CloseDialog {...closing} deposit={depositOf(closing.booking)} settings={money?.settings ?? null}
      onClose={() => setClosing(null)} onDone={text => { setClosing(null); refresh(text); }}
      onDataApi={async reason => { if (await advance(closing.booking, closing.how === 'cancel' ? 'cancelled' : 'no_show', closing.how === 'cancel' ? { cancel_reason: reason } : {})) setClosing(null); }} />}
  </div>;
}

function BookingDialog({ data, businessId, day: initialDay, booking, onClose, onDone }: {
  data: Data; businessId: string; day: string; booking?: Booking; onClose: () => void; onDone: (text: string) => void;
}) {
  const [supabase] = React.useState(() => createClient());
  const [serviceId, setServiceId] = React.useState(booking?.service_id ?? (data.services[0]?.id ?? ''));
  const [staffId, setStaffId] = React.useState(booking?.staff_id ?? '');
  const [day, setDay] = React.useState(booking ? lagosDay(booking.scheduled_at) : initialDay);
  const [time, setTime] = React.useState('');
  const [customerId, setCustomerId] = React.useState(''), [name, setName] = React.useState(''), [phone, setPhone] = React.useState(''), [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [bookings, setBookings] = React.useState<Booking[]>(data.bookings), [timeOff, setTimeOff] = React.useState<TimeOff[]>(data.timeOff);

  const able = data.staff.filter(s => s.is_active && data.links.some(l => l.staff_id === s.id && l.service_id === serviceId));
  const staff = able.some(s => s.id === staffId) ? staffId : (able[0]?.id ?? '');
  const duration = serviceMinutes(data.services.find(s => s.id === serviceId));

  // A different day may need that day's bookings and time off.
  React.useEffect(() => {
    if (day === initialDay) { setBookings(data.bookings); setTimeOff(data.timeOff); return; }
    let live = true;
    const from = lagosInstant(addDays(day, -1), '00:00'), to = lagosInstant(addDays(day, 2), '00:00');
    void Promise.all([
      supabase.from('appointments').select(BOOKING_COLUMNS).eq('business_id', businessId).gte('scheduled_at', from).lt('scheduled_at', to),
      supabase.from('service_staff_time_off').select('id, staff_id, starts_at, ends_at, reason').eq('business_id', businessId).gte('ends_at', from).lte('starts_at', to),
    ]).then(([b, t]) => { if (live) { setBookings((b.data as Booking[] | null) ?? []); setTimeOff((t.data as TimeOff[] | null) ?? []); } });
    return () => { live = false; };
  }, [supabase, businessId, day, initialDay, data.bookings, data.timeOff]);

  const slots = staff ? freeSlots({ day, duration, staffId: staff, hours: data.hours, timeOff, bookings, except: booking?.id }) : [];
  const chosen = slots.includes(time) ? time : '';
  const problem = !serviceId ? 'Choose a service.' : !staff ? 'Nobody on your staff does this service yet. Set it in Staff and hours.'
    : !chosen ? (slots.length ? 'Choose a time.' : 'No free times on this day. Try another day or staff member.')
    : !booking && !customerId && !name.trim() ? 'Choose a customer or type their name.' : '';

  const save = async () => {
    if (problem || busy) return;
    setBusy(true); setError('');
    const timing = { staff_id: staff, service_id: serviceId, scheduled_at: lagosInstant(day, chosen) };
    const result = booking
      ? await supabase.from('appointments').update(timing).eq('id', booking.id).select('id')
      : await supabase.from('appointments').insert({ business_id: businessId, ...timing, title: '', customer_id: customerId || null,
          customer_name: customerId ? null : name.trim(), customer_phone: phone.trim() || null, notes: notes.trim() || null }).select('id');
    setBusy(false);
    if (result.error) { setError(bookingError(result.error)); return; }
    if (!result.data?.length) { setError('You do not have permission to change bookings. Ask the business owner.'); return; }
    const who = data.staff.find(s => s.id === staff)?.name ?? '';
    onDone(`${booking ? 'Moved to' : 'Booked for'} ${chosen} on ${day} with ${who}.`);
  };

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{booking ? 'Reschedule booking' : 'New booking'}</DialogTitle>
        <DialogDescription>Only times when the staff member is working and free are shown.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <label className="space-y-1"><span>Service</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={serviceId} disabled={busy} onChange={e => { setServiceId(e.target.value); setTime(''); }}>
            <option value="">Choose a service</option>
            {data.services.map(s => <option key={s.id} value={s.id}>{s.name} ({serviceMinutes(s)} min)</option>)}
          </select></label>
        <label className="space-y-1"><span>Staff</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={staff} disabled={busy || able.length === 0} onChange={e => { setStaffId(e.target.value); setTime(''); }}>
            {able.length === 0 && <option value="">Nobody does this service</option>}
            {able.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="space-y-1"><span>Day</span>
          <Input type="date" value={day} min={lagosToday()} disabled={busy} onChange={e => { if (e.target.value) { setDay(e.target.value); setTime(''); } }} /></label>
        {slots.length > 0 && <div role="radiogroup" aria-label="Start time" className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {slots.map(s => <Button key={s} type="button" size="sm" role="radio" aria-checked={chosen === s} disabled={busy}
            variant={chosen === s ? 'default' : 'outline'} onClick={() => setTime(s)}>{s}</Button>)}
        </div>}
        {!booking && <>
          <label className="space-y-1"><span>Customer</span>
            <select className="h-11 w-full rounded-md border bg-background px-3" value={customerId} disabled={busy} onChange={e => setCustomerId(e.target.value)}>
              <option value="">New or walk-in customer</option>
              {data.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          {!customerId && <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span>Customer name</span><Input maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
            <label className="space-y-1"><span>Phone (optional)</span><Input maxLength={30} inputMode="tel" value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} /></label>
          </div>}
          <label className="space-y-1"><span>Notes (optional)</span><Input maxLength={500} value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} /></label>
        </>}
        {(error || problem) && <p role="alert" className="text-destructive">{error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={busy || !!problem} onClick={() => void save()}>{busy ? 'Saving…' : booking ? 'Move booking' : 'Book'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DepositDialog({ booking, banks, dueKobo, onClose, onDone }: { booking: Booking; banks: Bank[]; dueKobo: number; onClose: () => void; onDone: (text: string) => void }) {
  const [amount, setAmount] = React.useState(dueKobo > 0 ? formatKobo(dueKobo) : '');
  const [method, setMethod] = React.useState<'Cash' | 'Transfer'>('Cash');
  const [bank, setBank] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const locked = attempt.busy || attempt.uncertain;
  const problem = !/^\d{1,13}(\.\d{1,2})?$/.test(amount.trim()) || kobo(amount) <= 0 ? 'Enter the deposit in naira, for example 3000.' : '';
  const submit = async () => {
    const taken = await run(key => takeDepositAction(booking.id, { requestKey: key, amount: amount.trim(), method, bankAccountId: method === 'Transfer' ? bank || undefined : undefined }));
    if (taken) onDone(taken.status === 'held' ? `Deposit of ${naira(taken.amount)} taken in cash.` : `Deposit of ${naira(taken.amount)} recorded. The transfer waits for confirmation on Daily reconciliation.`);
  };
  return <Dialog open onOpenChange={open => { if (!open && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Take a deposit</DialogTitle>
        <DialogDescription>{booking.customer_name || 'The customer'}, {lagosTime(booking.scheduled_at)} on {lagosDay(booking.scheduled_at)}. It is held until the service, and refunded if they cancel in time.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <label className="space-y-1"><span>Amount (₦)</span><Input inputMode="decimal" value={amount} disabled={locked} onChange={e => setAmount(e.target.value)} /></label>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-2 gap-2">
          {(['Cash', 'Transfer'] as const).map(m => <Button key={m} type="button" role="radio" aria-checked={method === m} disabled={locked}
            variant={method === m ? 'default' : 'outline'} onClick={() => setMethod(m)}>{m === 'Cash' ? 'Cash' : 'Bank transfer'}</Button>)}
        </div>
        {method === 'Transfer' && <label className="space-y-1"><span>Bank account you expect it in (optional)</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={bank} disabled={locked} onChange={e => setBank(e.target.value)}>
            <option value="">Not sure yet: choose when confirming</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>}
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Saving…' : 'Take deposit'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CloseDialog({ booking, how, deposit, settings, onClose, onDone, onDataApi }: {
  booking: Booking; how: 'cancel' | 'no-show'; deposit?: Deposit; settings: BookingSettings | null;
  onClose: () => void; onDone: (text: string) => void; onDataApi: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState('');
  const open = deposit && ['awaiting_transfer', 'held'].includes(deposit.status) ? deposit : undefined;
  const free = how === 'cancel' && settings !== null && freeToCancel(booking.scheduled_at, settings.free_cancel_hours);
  const [outcome, setOutcome] = React.useState<'keep' | 'refund'>(free ? 'refund' : settings?.late_deposit ?? 'keep');
  const { attempt, run, reset } = useKeyedRequest();
  const [busy, setBusy] = React.useState(false);
  const locked = attempt.busy || attempt.uncertain || busy;
  const problem = how === 'cancel' && reason.trim().length < 3 ? 'Say why the booking is cancelled.'
    : open?.status === 'awaiting_transfer' ? "The deposit transfer is still awaiting confirmation. Confirm it or mark it not received on Daily reconciliation first." : '';
  const submit = async () => {
    if (!settings) { setBusy(true); await onDataApi(reason.trim()); setBusy(false); return; }
    const closed = await run(key => closeBookingAction(booking.id, how, { requestKey: key, reason: reason.trim(), deposit: open && !free ? outcome : undefined }));
    if (!closed) return;
    const what = how === 'cancel' ? 'Booking cancelled.' : 'Marked no-show.';
    onDone(closed.deposit === 'refund' ? `${what} Refund the ${naira(closed.deposit_amount ?? 0)} deposit ${open?.method === 'cash' ? 'from the till' : 'by transfer'}.`
      : closed.deposit === 'keep' ? `${what} The ${naira(closed.deposit_amount ?? 0)} deposit is kept as income.` : what);
  };
  const title = how === 'cancel' ? 'Cancel booking' : 'Mark no-show';
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy && !busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>{title}</DialogTitle>
        <DialogDescription>{booking.customer_name || 'The customer'} at {lagosTime(booking.scheduled_at)} on {lagosDay(booking.scheduled_at)}. The time becomes free again.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <label className="space-y-1"><span>{how === 'cancel' ? 'Reason' : 'Note (optional)'}</span>
          <Input maxLength={500} value={reason} disabled={locked} onChange={e => setReason(e.target.value)} /></label>
        {open?.status === 'held' && (free
          ? <p>Cancelled in time: the {naira(open.amount)} deposit is refunded {open.method === 'cash' ? 'from the till' : 'by transfer'}.</p>
          : <div role="radiogroup" aria-label="Deposit" className="space-y-1">
              <p>{how === 'cancel' ? 'Cancelled late' : 'No-show'}: your rule is to {settings?.late_deposit === 'refund' ? 'refund' : 'keep'} the {naira(open.amount)} deposit.</p>
              <div className="grid grid-cols-2 gap-2">
                {(['keep', 'refund'] as const).map(o => <Button key={o} type="button" role="radio" aria-checked={outcome === o} disabled={locked}
                  variant={outcome === o ? 'default' : 'outline'} onClick={() => setOutcome(o)}>{o === 'keep' ? 'Keep deposit' : 'Refund deposit'}</Button>)}
              </div>
              {outcome !== settings?.late_deposit && <p className="text-muted-foreground">Going against your rule needs someone who can approve sales.</p>}
            </div>)}
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" variant="destructive" disabled={attempt.busy || busy || !!problem} onClick={() => void submit()}>{attempt.busy || busy ? 'Saving…' : title}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function InvoiceDialog({ booking, customers, onClose, onDone }: { booking: Booking; customers: Customer[]; onClose: () => void; onDone: (text: string) => void }) {
  const [customerId, setCustomerId] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const problem = !booking.customer_id && !customerId ? 'Choose the customer to invoice. Add them in Customers if they are new.' : '';
  const submit = async () => {
    const billed = await run(key => billByInvoiceAction(booking.id, { requestKey: key, customerId: booking.customer_id ? undefined : customerId }));
    if (billed) onDone(Number(billed.deposit_applied) > 0
      ? `Invoice ${billed.invoice_number} issued for ${naira(billed.total)}. The ${naira(billed.deposit_applied)} deposit was applied; ${naira(billed.outstanding)} is still owed.`
      : `Invoice ${billed.invoice_number} issued for ${naira(billed.total)}.`);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Bill by invoice</DialogTitle>
        <DialogDescription>An invoice for the service is issued now, and any deposit held for this booking is taken off it. The customer pays the rest later.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        {!booking.customer_id && <label className="space-y-1"><span>Customer</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={customerId} disabled={attempt.busy || attempt.uncertain} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Choose a customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>}
        {(attempt.error || problem) && <p role="alert" className="text-destructive">{attempt.error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Issuing…' : 'Issue invoice'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
