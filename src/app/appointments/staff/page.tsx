"use client";
// Service staff (Doc 10, Doc 07 M-13): the people customers book, by name, the services each does, their weekly hours
// and their time off. Changing them needs settings.edit (Owner, Admin); everyone who sees services can read them.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { WEEKDAYS, bookingError, lagosDay, lagosInstant, lagosTime, type Hours, type Service, type Staff, type StaffService, type TimeOff } from '@/lib/bookings';
import { lagosToday } from '@/lib/transfers';
import { useBusiness } from '@/components/business-provider';
import { getCostRatesAction, saveCostRatesAction } from '@/app/jobs/actions';
import type { CostRates } from '@/lib/jobs';

type Data = { staff: Staff[]; services: Service[]; links: StaffService[]; hours: Hours[]; timeOff: TimeOff[] };
type Day = { on: boolean; starts: string; ends: string };

export default function StaffPage() {
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const [name, setName] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const id = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(id);
        const [staff, services, links, hours, timeOff] = await Promise.all([
          supabase.from('service_staff').select('id, name, is_active').eq('business_id', id).order('name'),
          supabase.from('catalog_items').select('id, name, duration, unit_price').eq('business_id', id).eq('item_type', 'SERVICE').eq('is_active', true).order('name'),
          supabase.from('service_staff_services').select('staff_id, service_id').eq('business_id', id),
          supabase.from('service_staff_hours').select('staff_id, weekday, starts, ends').eq('business_id', id).order('starts'),
          supabase.from('service_staff_time_off').select('id, staff_id, starts_at, ends_at, reason').eq('business_id', id).gte('ends_at', new Date().toISOString()).order('starts_at'),
        ]);
        if (!live) return;
        if ([staff, services, links, hours, timeOff].some(r => r.error)) { setError('Staff are unavailable. You may not have access to services.'); return; }
        setError('');
        setData({ staff: staff.data as Staff[], services: services.data as Service[], links: links.data as StaffService[], hours: hours.data as Hours[], timeOff: timeOff.data as TimeOff[] });
      } catch { if (live) setError('Staff are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, version]);

  const done = (text: string) => { setMessage(text); setError(''); setVersion(v => v + 1); };
  const fail = (failed: { message?: string; code?: string }) => { setMessage(''); setError(bookingError(failed, 'The change was not saved. Refresh and try again.')); };

  const add = async () => {
    if (!businessId || !name.trim() || busy) return;
    setBusy(true);
    const { data: rows, error: failed } = await supabase.from('service_staff').insert({ business_id: businessId, name: name.trim() }).select('id');
    if (!failed && rows?.[0]) {
      // Monday to Saturday, 9 to 6, until the owner changes it.
      await supabase.from('service_staff_hours').insert([1, 2, 3, 4, 5, 6].map(weekday => ({ business_id: businessId, staff_id: rows[0].id, weekday, starts: '09:00', ends: '18:00' })));
    }
    setBusy(false);
    if (failed) { fail(failed); return; }
    setName(''); done(`${name.trim()} added, working Monday to Saturday, 09:00 to 18:00. Choose the services they do.`);
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Staff and hours</h1>
        <p className="text-muted-foreground">The people customers book, what each one does, and when they work. They don&apos;t need to use CACU.</p></div>
      <Button asChild variant="outline"><Link href="/appointments">Back to appointments</Link></Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data && !error && <p role="status">Loading…</p>}
    {data && <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void add(); }}>
      <label className="space-y-1 text-sm"><span>Name</span><Input maxLength={100} value={name} disabled={busy} placeholder="For example: Ada" onChange={e => setName(e.target.value)} /></label>
      <Button type="submit" disabled={busy || !name.trim()}>Add staff</Button>
    </form>}
    {data && data.services.length === 0 && <p className="text-sm text-muted-foreground">Add services in the catalogue first, then choose who does each one.</p>}
    {data && <CostRatesCard staff={data.staff.filter(s => s.is_active)} />}
    <div className="grid gap-4 lg:grid-cols-2">
      {data?.staff.map(person => <StaffCard key={person.id} person={person} data={data} businessId={businessId!} onDone={done} onFail={fail} />)}
    </div>
  </div>;
}

function StaffCard({ person, data, businessId, onDone, onFail }: {
  person: Staff; data: Data; businessId: string; onDone: (text: string) => void; onFail: (error: { message?: string; code?: string }) => void;
}) {
  const [supabase] = React.useState(() => createClient());
  const own = data.hours.filter(h => h.staff_id === person.id);
  const [week, setWeek] = React.useState<Day[]>(() => WEEKDAYS.map((_, i) => {
    const first = own.find(h => h.weekday === i + 1);
    return { on: !!first, starts: first?.starts.slice(0, 5) ?? '09:00', ends: first?.ends.slice(0, 5) ?? '18:00' };
  }));
  const [offDay, setOffDay] = React.useState(lagosToday()), [offFrom, setOffFrom] = React.useState('09:00'), [offTo, setOffTo] = React.useState('18:00'), [offWhy, setOffWhy] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const does = new Set(data.links.filter(l => l.staff_id === person.id).map(l => l.service_id));
  const split = own.some(h => own.filter(o => o.weekday === h.weekday).length > 1);
  const badHours = week.some(d => d.on && d.ends <= d.starts);

  const run = async (work: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, text: string) => {
    setBusy(true);
    const { error } = await work();
    setBusy(false);
    if (error) onFail(error); else onDone(text);
  };
  const toggleService = (service: Service) => run(() => does.has(service.id)
    ? supabase.from('service_staff_services').delete().eq('business_id', businessId).eq('staff_id', person.id).eq('service_id', service.id)
    : supabase.from('service_staff_services').insert({ business_id: businessId, staff_id: person.id, service_id: service.id }),
    `${person.name} ${does.has(service.id) ? 'no longer does' : 'now does'} ${service.name}.`);
  // Saving the week replaces their hours with one range a day.
  const saveHours = () => run(async () => {
    const removed = await supabase.from('service_staff_hours').delete().eq('business_id', businessId).eq('staff_id', person.id);
    if (removed.error) return removed;
    const rows = week.flatMap((d, i) => d.on ? [{ business_id: businessId, staff_id: person.id, weekday: i + 1, starts: d.starts, ends: d.ends }] : []);
    return rows.length ? supabase.from('service_staff_hours').insert(rows) : { error: null };
  }, `${person.name}'s hours saved.`);
  const addTimeOff = () => run(() => supabase.from('service_staff_time_off').insert({ business_id: businessId, staff_id: person.id,
    starts_at: lagosInstant(offDay, offFrom), ends_at: lagosInstant(offDay, offTo), reason: offWhy.trim() }), `Time off added for ${person.name}.`);
  const removeTimeOff = (t: TimeOff) => run(() => supabase.from('service_staff_time_off').delete().eq('id', t.id), 'Time off removed.');
  const setActive = (active: boolean) => run(() => supabase.from('service_staff').update({ is_active: active }).eq('id', person.id),
    active ? `${person.name} can be booked again.` : `${person.name} can no longer be booked. Their past bookings keep their name.`);

  return <Card className={person.is_active ? '' : 'opacity-70'}>
    <CardHeader className="pb-3"><CardTitle className="text-lg">{person.name}</CardTitle>
      <CardDescription>{person.is_active ? `${does.size} service${does.size === 1 ? '' : 's'}` : 'No longer works here'}</CardDescription></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <fieldset className="space-y-1" disabled={busy || !person.is_active}><legend className="font-semibold">Services</legend>
        {data.services.length === 0 ? <p className="text-muted-foreground">No services yet.</p> : <div className="flex flex-wrap gap-3">
          {data.services.map(s => <label key={s.id} className="flex items-center gap-1">
            <input type="checkbox" checked={does.has(s.id)} onChange={() => void toggleService(s)} />{s.name}</label>)}
        </div>}
      </fieldset>
      <fieldset className="space-y-1" disabled={busy || !person.is_active}><legend className="font-semibold">Working hours</legend>
        {split && <p className="text-muted-foreground">Some days have more than one range. Saving here keeps one range a day; add breaks as time off.</p>}
        {WEEKDAYS.map((label, i) => <div key={label} className="flex flex-wrap items-center gap-2">
          <label className="flex w-28 items-center gap-1"><input type="checkbox" checked={week[i].on}
            onChange={e => setWeek(w => w.map((d, j) => j === i ? { ...d, on: e.target.checked } : d))} />{label}</label>
          {week[i].on ? <>
            <Input aria-label={`${label} start`} type="time" className="h-8 w-28" value={week[i].starts} onChange={e => setWeek(w => w.map((d, j) => j === i ? { ...d, starts: e.target.value } : d))} />
            <span>to</span>
            <Input aria-label={`${label} end`} type="time" className="h-8 w-28" value={week[i].ends} onChange={e => setWeek(w => w.map((d, j) => j === i ? { ...d, ends: e.target.value } : d))} />
          </> : <span className="text-muted-foreground">Off</span>}
        </div>)}
        {badHours && <p role="alert" className="text-destructive">Each working day must end after it starts.</p>}
        <Button size="sm" type="button" disabled={badHours} onClick={() => void saveHours()}>Save hours</Button>
      </fieldset>
      <fieldset className="space-y-2" disabled={busy || !person.is_active}><legend className="font-semibold">Time off</legend>
        {data.timeOff.filter(t => t.staff_id === person.id).map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>{lagosDay(t.starts_at)} {lagosTime(t.starts_at)}–{lagosDay(t.ends_at) === lagosDay(t.starts_at) ? '' : `${lagosDay(t.ends_at)} `}{lagosTime(t.ends_at)}{t.reason ? `: ${t.reason}` : ''}</span>
          <Button size="sm" type="button" variant="outline" onClick={() => void removeTimeOff(t)}>Remove</Button>
        </div>)}
        <div className="flex flex-wrap items-end gap-2">
          <Input aria-label="Time off day" type="date" className="h-8 w-40" value={offDay} onChange={e => e.target.value && setOffDay(e.target.value)} />
          <Input aria-label="Time off from" type="time" className="h-8 w-28" value={offFrom} onChange={e => setOffFrom(e.target.value)} />
          <Input aria-label="Time off to" type="time" className="h-8 w-28" value={offTo} onChange={e => setOffTo(e.target.value)} />
          <Input aria-label="Time off reason" maxLength={200} className="h-8 w-40" placeholder="Reason (optional)" value={offWhy} onChange={e => setOffWhy(e.target.value)} />
          <Button size="sm" type="button" disabled={offTo <= offFrom} onClick={() => void addTimeOff()}>Add time off</Button>
        </div>
      </fieldset>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void setActive(!person.is_active)}>{person.is_active ? 'No longer works here' : 'Bring back'}</Button>
    </CardContent>
  </Card>;
}

/** Job profit (Chairman): what an hour of each person's time costs the business. Only the owner sees and sets these. */
function CostRatesCard({ staff }: { staff: Staff[] }) {
  const { business } = useBusiness();
  const owner = business?.userRole === 'owner';
  const [rates, setRates] = React.useState<CostRates | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false), [note, setNote] = React.useState('');
  React.useEffect(() => {
    if (!owner) return;
    let live = true;
    void getCostRatesAction().then(r => { if (live && r.success && r.data) { setRates(r.data); setDraft(Object.fromEntries(Object.entries(r.data.rates).map(([k, v]) => [k, String(Number(v))]))); } });
    return () => { live = false; };
  }, [owner]);
  if (!owner || !rates?.available || staff.length === 0) return null;
  const bad = Object.values(draft).some(v => v.trim() && !/^\d{1,13}(\.\d{1,2})?$/.test(v.trim()));
  const save = async () => {
    setBusy(true); setNote('');
    const result = await saveCostRatesAction(staff.filter(s => draft[s.id]?.trim()).map(s => ({ staffId: s.id, hourly: draft[s.id].trim() })));
    setBusy(false);
    setNote(result.success ? 'Cost rates saved. Job profit uses them for labour.' : result.error);
  };
  return <Card><CardHeader><CardTitle className="text-lg">Cost per hour, for job profit</CardTitle>
    <CardDescription>What an hour of each person&apos;s time costs you. Only you can see these. They are not linked to payroll.</CardDescription></CardHeader>
    <CardContent className="space-y-2 text-sm">
      {staff.map(s => <label key={s.id} className="flex items-center gap-2"><span className="w-40">{s.name}</span>
        <Input aria-label={`Cost per hour for ${s.name} (₦)`} inputMode="decimal" className="h-9 w-32" value={draft[s.id] ?? ''} disabled={busy}
          onChange={e => setDraft(d => ({ ...d, [s.id]: e.target.value }))} /></label>)}
      {bad && <p role="alert" className="text-destructive">Enter each rate in naira, for example 1500.</p>}
      {note && <p role="status">{note}</p>}
      <Button size="sm" disabled={busy || bad} onClick={() => void save()}>{busy ? 'Saving…' : 'Save cost rates'}</Button>
    </CardContent></Card>;
}
