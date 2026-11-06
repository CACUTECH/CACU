"use client";
// Bookings day view (Doc 10 services, bookings and jobs rules; Doc 12 SCR-15). Each staff member's bookings for the
// day, a new-booking dialog that offers only free times, and the booking's next step. The database enforces every
// rule (no overlaps, working hours, time off, the booking states); this screen only avoids offering what it refuses.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { lagosToday } from '@/lib/transfers';
import {
  STATUS_LABELS, addDays, bookingError, freeSlots, lagosDay, lagosInstant, lagosTime, serviceMinutes,
  type Booking, type Hours, type Service, type Staff, type StaffService, type TimeOff,
} from '@/lib/bookings';

type Customer = { id: string; name: string };
type Data = { staff: Staff[]; services: Service[]; links: StaffService[]; hours: Hours[]; timeOff: TimeOff[]; bookings: Booking[]; customers: Customer[] };
const BOOKING_COLUMNS = 'id, staff_id, service_id, scheduled_at, ends_at, duration_minutes, title, status, customer_id, customer_name, customer_phone, notes, cancel_reason';

export default function AppointmentsPage() {
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [day, setDay] = React.useState(lagosToday());
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [editing, setEditing] = React.useState<{ booking?: Booking } | null>(null);
  const [cancelling, setCancelling] = React.useState<Booking | null>(null);
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
        const [staff, services, links, hours, timeOff, bookings, customers] = await Promise.all([
          supabase.from('service_staff').select('id, name, is_active').eq('business_id', id).order('name'),
          supabase.from('catalog_items').select('id, name, duration, unit_price').eq('business_id', id).eq('item_type', 'SERVICE').eq('is_active', true).order('name'),
          supabase.from('service_staff_services').select('staff_id, service_id').eq('business_id', id),
          supabase.from('service_staff_hours').select('staff_id, weekday, starts, ends').eq('business_id', id),
          supabase.from('service_staff_time_off').select('id, staff_id, starts_at, ends_at, reason').eq('business_id', id).gte('ends_at', from).lte('starts_at', to),
          supabase.from('appointments').select(BOOKING_COLUMNS).eq('business_id', id).gte('scheduled_at', from).lt('scheduled_at', to).order('scheduled_at'),
          supabase.from('customers').select('id, name').eq('business_id', id).order('name').limit(500),
        ]);
        if (!live) return;
        const failed = [staff, services, links, hours, timeOff, bookings].find(r => r.error);
        if (failed) { setError('Bookings are unavailable. You may not have access to services. Refresh to try again.'); return; }
        setError('');
        setData({ staff: staff.data as Staff[], services: services.data as Service[], links: links.data as StaffService[], hours: hours.data as Hours[],
          timeOff: timeOff.data as TimeOff[], bookings: bookings.data as Booking[], customers: (customers.data as Customer[] | null) ?? [] });
      } catch { if (live) setError('Bookings are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, day, version]);

  const refresh = (text: string) => { setMessage(text); setVersion(v => v + 1); };

  // Moves a booking to its next state. Row security hides the change from people without services.edit, so an empty
  // result means they were not allowed.
  const advance = async (booking: Booking, status: Booking['status'], extra: Record<string, string> = {}) => {
    setMessage('');
    const { data: rows, error: failed } = await supabase.from('appointments').update({ status, ...extra }).eq('id', booking.id).select('id');
    if (failed) { setError(bookingError(failed)); return false; }
    if (!rows?.length) { setError('You do not have permission to change bookings. Ask the business owner.'); return false; }
    setError('');
    refresh(`${booking.customer_name || 'Booking'}: ${STATUS_LABELS[status].toLowerCase()}.`);
    return true;
  };

  const services = new Map((data?.services ?? []).map(s => [s.id, s]));
  const customers = new Map((data?.customers ?? []).map(c => [c.id, c.name]));
  const todays = (data?.bookings ?? []).filter(b => lagosDay(b.scheduled_at) === day);
  const shown = (data?.staff ?? []).filter(s => s.is_active || todays.some(b => b.staff_id === s.id));
  const now = Date.now();

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Appointments</h1>
        <p className="text-muted-foreground">Each staff member&apos;s bookings for the day. Times are Lagos time.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" aria-label="Previous day" onClick={() => setDay(d => addDays(d, -1))}>‹</Button>
        <label className="space-y-1 text-sm"><span>Day</span><Input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} /></label>
        <Button variant="outline" aria-label="Next day" onClick={() => setDay(d => addDays(d, 1))}>›</Button>
        <Button asChild variant="outline"><Link href="/appointments/staff">Staff and hours</Link></Button>
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
                return <li key={b.id} className={`rounded border p-2 ${closed ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{lagosTime(b.scheduled_at)}–{lagosTime(b.ends_at)} {services.get(b.service_id)?.name ?? b.title}</span>
                    <Badge variant={closed ? 'outline' : b.status === 'completed' ? 'secondary' : 'default'}>{STATUS_LABELS[b.status]}</Badge>
                  </div>
                  <p>{(b.customer_id && customers.get(b.customer_id)) || b.customer_name || 'Customer'}{b.customer_phone ? `, ${b.customer_phone}` : ''}</p>
                  {b.notes && <p className="text-muted-foreground">{b.notes}</p>}
                  {b.cancel_reason && <p className="text-muted-foreground">Cancelled: {b.cancel_reason}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {b.status === 'confirmed' && <>
                      <Button size="sm" onClick={() => void advance(b, 'checked_in')}>Check in</Button>
                      <Button size="sm" variant="outline" onClick={() => { setMessage(''); setEditing({ booking: b }); }}>Reschedule</Button>
                      <Button size="sm" variant="outline" onClick={() => { setMessage(''); setCancelling(b); }}>Cancel</Button>
                      {new Date(b.scheduled_at).getTime() <= now && <Button size="sm" variant="outline" onClick={() => void advance(b, 'no_show')}>No-show</Button>}
                    </>}
                    {b.status === 'checked_in' && <Button size="sm" onClick={() => void advance(b, 'completed')}>Complete</Button>}
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
    {cancelling && <CancelDialog booking={cancelling} onClose={() => setCancelling(null)}
      onCancel={async reason => { if (await advance(cancelling, 'cancelled', { cancel_reason: reason })) setCancelling(null); }} />}
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

function CancelDialog({ booking, onClose, onCancel }: { booking: Booking; onClose: () => void; onCancel: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState(''), [busy, setBusy] = React.useState(false);
  const submit = async () => { setBusy(true); await onCancel(reason.trim()); setBusy(false); };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Cancel booking</DialogTitle>
        <DialogDescription>{booking.customer_name || 'The customer'} at {lagosTime(booking.scheduled_at)} on {lagosDay(booking.scheduled_at)}. The time becomes free again.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm"><span>Reason</span><Input maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <DialogFooter><Button className="w-full" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>{busy ? 'Cancelling…' : 'Cancel booking'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
