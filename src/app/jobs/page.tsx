"use client";
// Jobs list (Doc 10 services rules; Doc 12 SCR-16): open jobs first, then recent ones, and a dialog to open a new job.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { JOB_COLUMNS, JOB_STATUS, jobError, type Job } from '@/lib/jobs';

type Option = { id: string; name: string };
const FILTERS = [{ value: 'active', label: 'Open and in progress' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }] as const;

export default function JobsPage() {
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<typeof FILTERS[number]['value']>('active');
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  const [customers, setCustomers] = React.useState<Option[]>([]), [staff, setStaff] = React.useState<Option[]>([]);
  const [error, setError] = React.useState(''), [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const id = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(id);
        let query = supabase.from('jobs').select(JOB_COLUMNS).eq('business_id', id);
        query = filter === 'active' ? query.in('status', ['open', 'in_progress']) : query.eq('status', filter);
        const [list, people, team] = await Promise.all([query.order('created_at', { ascending: false }).limit(200),
          supabase.from('customers').select('id, name').eq('business_id', id).order('name').limit(500),
          supabase.from('service_staff').select('id, name').eq('business_id', id).eq('is_active', true).order('name')]);
        if (!live) return;
        if (list.error) { setError('Jobs are unavailable. You may not have access to services.'); return; }
        setError(''); setJobs(list.data as Job[]); setCustomers((people.data as Option[] | null) ?? []); setStaff((team.data as Option[] | null) ?? []);
      } catch { if (live) setError('Jobs are unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, filter]);

  const names = new Map(customers.map(c => [c.id, c.name]));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">Work Orders &amp; Jobs</h1>
        <p className="text-muted-foreground">Jobs collect the services and materials used. Completing a job takes its materials out of stock.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm"><span>Show</span>
          <select className="h-10 rounded-md border bg-background px-3" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select></label>
        <Button disabled={!businessId} onClick={() => setCreating(true)}>New job</Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!jobs && !error && <p role="status">Loading…</p>}
    {jobs && jobs.length === 0 && <p className="text-muted-foreground">No jobs here yet.</p>}
    {jobs && jobs.length > 0 && <ul className="divide-y rounded border" aria-label="Jobs">
      {jobs.map(j => <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><Link href={`/jobs/${j.id}`} className="font-semibold underline">{j.number ?? 'Job'}: {j.title}</Link>
          <span className="block text-muted-foreground">{(j.customer_id && names.get(j.customer_id)) || j.customer_name || 'Customer'}{j.due_date ? `, due ${j.due_date}` : ''}</span></span>
        <span className="flex gap-2">
          <Badge variant={j.status === 'cancelled' ? 'outline' : j.status === 'completed' ? 'secondary' : 'default'}>{JOB_STATUS[j.status]}</Badge>
          {j.bill_kind && <Badge variant="secondary">{j.bill_kind === 'sale' ? 'Paid at the till' : 'Invoiced'}</Badge>}
        </span>
      </li>)}
    </ul>}
    {creating && businessId && <NewJobDialog businessId={businessId} customers={customers} staff={staff} onClose={() => setCreating(false)}
      onDone={id => { window.location.assign(`/jobs/${id}`); }} />}
  </div>;
}

function NewJobDialog({ businessId, customers, staff, onClose, onDone }: { businessId: string; customers: Option[]; staff: Option[]; onClose: () => void; onDone: (id: string) => void }) {
  const [supabase] = React.useState(() => createClient());
  const [title, setTitle] = React.useState(''), [customerId, setCustomerId] = React.useState(''), [name, setName] = React.useState('');
  const [staffId, setStaffId] = React.useState(''), [due, setDue] = React.useState(''), [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const problem = !title.trim() ? 'Give the job a title.' : !customerId && !name.trim() ? 'Choose a customer or type their name.' : '';
  const save = async () => {
    setBusy(true); setError('');
    const { data, error: failed } = await supabase.from('jobs').insert({ business_id: businessId, title: title.trim(), customer_id: customerId || null,
      customer_name: customerId ? null : name.trim(), staff_id: staffId || null, due_date: due || null, description: description.trim() || null }).select('id');
    setBusy(false);
    if (failed || !data?.length) { setError(jobError(failed)); return; }
    onDone(data[0].id);
  };
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>New job</DialogTitle><DialogDescription>Add the services and materials on the next screen.</DialogDescription></DialogHeader>
      <div className="grid gap-3 text-sm">
        <label className="space-y-1"><span>Title</span><Input maxLength={200} value={title} disabled={busy} placeholder="For example: Service and brake pads" onChange={e => setTitle(e.target.value)} /></label>
        <label className="space-y-1"><span>Customer</span>
          <select className="h-11 w-full rounded-md border bg-background px-3" value={customerId} disabled={busy} onChange={e => setCustomerId(e.target.value)}>
            <option value="">New or walk-in customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        {!customerId && <label className="space-y-1"><span>Customer name</span><Input maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span>Assigned to (optional)</span>
            <select className="h-11 w-full rounded-md border bg-background px-3" value={staffId} disabled={busy} onChange={e => setStaffId(e.target.value)}>
              <option value="">Nobody yet</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="space-y-1"><span>Due (optional)</span><Input type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} /></label>
        </div>
        <label className="space-y-1"><span>Notes (optional)</span><Input maxLength={1000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} /></label>
        {(error || problem) && <p role="alert" className="text-destructive">{error || problem}</p>}
      </div>
      <DialogFooter><Button className="w-full" disabled={busy || !!problem} onClick={() => void save()}>{busy ? 'Opening…' : 'Open job'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
