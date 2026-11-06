"use client";
// A job (Doc 10 services rules): service and material lines and labour while it is open or in progress; completing it
// takes its materials out of stock at cost; a completed job is paid at the till or billed by invoice; job profit on
// Chairman for people who can see the books.
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { billJobByInvoiceAction, completeJobAction, getJobMoneyAction } from '../actions';
import { useKeyedRequest } from '@/hooks/use-keyed-request';
import { naira } from '@/lib/transfers';
import { JOB_COLUMNS, JOB_STATUS, jobError, type Job, type JobLabour, type JobLine, type JobMoney } from '@/lib/jobs';

type Item = { id: string; name: string; item_type: 'SERVICE' | 'PRODUCT'; unit_price: number; stock_quantity: number | null };
type Option = { id: string; name: string };

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [supabase] = React.useState(() => createClient());
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);
  const [lines, setLines] = React.useState<JobLine[]>([]), [labour, setLabour] = React.useState<JobLabour[]>([]);
  const [items, setItems] = React.useState<Item[]>([]), [staff, setStaff] = React.useState<Option[]>([]), [customers, setCustomers] = React.useState<Option[]>([]);
  const [money, setMoney] = React.useState<JobMoney | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const [dialog, setDialog] = React.useState<'complete' | 'cancel' | 'invoice' | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const business = businessId ?? await getActiveBusinessIdAction();
        if (!live) return;
        setBusinessId(business);
        const [found, jobLines, jobLabour, catalogue, team, people, figures] = await Promise.all([
          supabase.from('jobs').select(JOB_COLUMNS).eq('business_id', business).eq('id', id).limit(1),
          supabase.from('job_lines').select('id, catalog_item_id, quantity').eq('business_id', business).eq('job_id', id),
          supabase.from('job_labour').select('id, staff_id, minutes, note').eq('business_id', business).eq('job_id', id),
          supabase.from('catalog_items').select('id, name, item_type, unit_price, stock_quantity').eq('business_id', business).eq('is_active', true).order('name'),
          supabase.from('service_staff').select('id, name').eq('business_id', business).order('name'),
          supabase.from('customers').select('id, name').eq('business_id', business).order('name').limit(500),
          getJobMoneyAction(id),
        ]);
        if (!live) return;
        const row = (found.data as Job[] | null)?.[0];
        if (found.error || !row) { setError('Job not found, or you do not have access to services.'); return; }
        setJob(row); setLines((jobLines.data as JobLine[] | null) ?? []); setLabour((jobLabour.data as JobLabour[] | null) ?? []);
        setItems(((catalogue.data as Item[] | null) ?? []).filter(i => Number(i.unit_price) > 0 && ['SERVICE', 'PRODUCT'].includes(i.item_type)));
        setStaff((team.data as Option[] | null) ?? []); setCustomers((people.data as Option[] | null) ?? []);
        setMoney(figures.success ? figures.data : null);
      } catch { if (live) setError('The job is unavailable. Refresh to try again.'); }
    })();
    return () => { live = false; };
  }, [supabase, businessId, id, version]);

  const done = (text: string) => { setMessage(text); setError(''); setVersion(v => v + 1); };
  const write = async (work: () => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>, text: string) => {
    setBusy(true); setMessage('');
    const { data, error: failed } = await work();
    setBusy(false);
    if (failed) { setError(jobError(failed)); return false; }
    if (!data?.length) { setError('You do not have permission to change jobs. Ask the business owner.'); return false; }
    done(text); return true;
  };

  if (error && !job) return <p role="alert" className="text-destructive">{error}</p>;
  if (!job || !businessId) return <p role="status">Loading…</p>;
  const editable = job.status === 'open' || job.status === 'in_progress';
  const itemOf = new Map(items.map(i => [i.id, i]));
  const staffOf = new Map(staff.map(s => [s.id, s.name]));
  const customer = (job.customer_id && customers.find(c => c.id === job.customer_id)?.name) || job.customer_name || 'Customer';

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-headline text-3xl font-bold">{job.number ?? 'Job'}: {job.title}</h1>
        <p className="text-muted-foreground">{customer}{job.staff_id ? `, assigned to ${staffOf.get(job.staff_id) ?? 'staff'}` : ''}{job.due_date ? `, due ${job.due_date}` : ''}</p>
        {job.description && <p className="text-sm">{job.description}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{JOB_STATUS[job.status]}</Badge>
        {job.bill_kind && <Badge variant="secondary">{job.bill_kind === 'sale' ? 'Paid at the till' : 'Invoiced'}</Badge>}
        <Button asChild variant="outline"><Link href="/jobs">All jobs</Link></Button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {job.cancel_reason && <p className="text-muted-foreground">Cancelled: {job.cancel_reason}</p>}

    <div className="flex flex-wrap gap-2">
      {job.status === 'open' && <Button disabled={busy} onClick={() => void write(() => supabase.from('jobs').update({ status: 'in_progress' }).eq('id', job.id).select('id'), 'Job started.')}>Start job</Button>}
      {editable && money && <Button disabled={busy || lines.length === 0} onClick={() => { setMessage(''); setDialog('complete'); }}>Complete job</Button>}
      {editable && <Button variant="outline" disabled={busy} onClick={() => { setMessage(''); setDialog('cancel'); }}>Cancel job</Button>}
      {job.status === 'completed' && money && !job.bill_kind && <>
        <Button asChild><Link href={`/pos?job=${job.id}`}>Take payment</Link></Button>
        <Button variant="outline" onClick={() => { setMessage(''); setDialog('invoice'); }}>Bill by invoice</Button>
      </>}
    </div>
    {editable && !money && <p className="text-sm text-muted-foreground">Completing jobs and taking materials out of stock is available once your books are turned on.</p>}

    <Card><CardHeader><CardTitle>Services and materials</CardTitle>
      <CardDescription>Charged at catalogue prices. Materials leave stock when the job is completed.</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {lines.length === 0 ? <p className="text-muted-foreground">Nothing added yet.</p> : <ul className="space-y-1" aria-label="Job lines">
          {lines.map(l => { const item = itemOf.get(l.catalog_item_id); return <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{l.quantity} x {item?.name ?? 'Item'} <span className="text-muted-foreground">({item?.item_type === 'PRODUCT' ? 'material' : 'service'}{item ? `, ${naira(Number(item.unit_price) * l.quantity)}` : ''})</span></span>
            {editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => void write(() => supabase.from('job_lines').delete().eq('id', l.id).select('id'), 'Removed.')}>Remove</Button>}
          </li>; })}
        </ul>}
        {editable && <AddLine items={items.filter(i => !lines.some(l => l.catalog_item_id === i.id))} busy={busy}
          onAdd={(itemId, quantity) => void write(() => supabase.from('job_lines').insert({ business_id: businessId, job_id: job.id, catalog_item_id: itemId, quantity }).select('id'), 'Added to the job.')} />}
      </CardContent></Card>

    <Card><CardHeader><CardTitle>Labour</CardTitle><CardDescription>Time each person spent, for job profit.</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {labour.length === 0 ? <p className="text-muted-foreground">No time recorded.</p> : <ul className="space-y-1" aria-label="Labour">
          {labour.map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{staffOf.get(t.staff_id) ?? 'Staff'}: {Math.floor(t.minutes / 60)}h {t.minutes % 60}m{t.note ? `, ${t.note}` : ''}</span>
            {editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => void write(() => supabase.from('job_labour').delete().eq('id', t.id).select('id'), 'Removed.')}>Remove</Button>}
          </li>)}
        </ul>}
        {editable && staff.length > 0 && <AddLabour staff={staff} busy={busy}
          onAdd={(staffId, minutes) => void write(() => supabase.from('job_labour').insert({ business_id: businessId, job_id: job.id, staff_id: staffId, minutes }).select('id'), 'Time recorded.')} />}
      </CardContent></Card>

    {money && <Card><CardHeader><CardTitle>Figures</CardTitle>
      <CardDescription>{money.materials_issued ? 'Materials at the cost they left stock at.' : 'Materials at current cost until the job is completed.'}</CardDescription></CardHeader>
      <CardContent><dl className="grid max-w-sm grid-cols-2 gap-y-1 text-sm">
        <dt>Charge</dt><dd className="text-right">{naira(money.revenue)}</dd>
        <dt>Materials at cost</dt><dd className="text-right">{naira(money.materials_cost)}</dd>
        {money.profit && <>
          <dt>Labour at cost</dt><dd className="text-right">{naira(money.profit.labour_cost)}</dd>
          <dt className="font-semibold">Profit</dt><dd className="text-right font-semibold">{naira(money.profit.profit)}</dd>
        </>}
      </dl>
      {money.profit && money.profit.unrated_entries > 0 && <p className="mt-2 text-sm text-amber-700">Some labour has no cost rate. The owner sets them on Staff and hours.</p>}
      </CardContent></Card>}

    {dialog === 'complete' && <CompleteDialog job={job} lines={lines} items={itemOf} onClose={() => setDialog(null)}
      onDone={figures => { setDialog(null); done(`Job completed. Materials costing ${naira(figures.materials_cost)} left stock.`); }} />}
    {dialog === 'cancel' && <CancelJob onClose={() => setDialog(null)}
      onCancel={async reason => { if (await write(() => supabase.from('jobs').update({ status: 'cancelled', cancel_reason: reason }).eq('id', job.id).select('id'), 'Job cancelled.')) setDialog(null); }} />}
    {dialog === 'invoice' && <InvoiceJob job={job} customers={customers} onClose={() => setDialog(null)}
      onDone={text => { setDialog(null); done(text); }} />}
  </div>;
}

function AddLine({ items, busy, onAdd }: { items: Item[]; busy: boolean; onAdd: (itemId: string, quantity: number) => void }) {
  const [itemId, setItemId] = React.useState(''), [quantity, setQuantity] = React.useState('1');
  const ok = itemId && /^\d{1,6}$/.test(quantity) && Number(quantity) > 0;
  return <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (ok) { onAdd(itemId, Number(quantity)); setItemId(''); setQuantity('1'); } }}>
    <label className="space-y-1"><span>Service or material</span>
      <select className="h-10 rounded-md border bg-background px-3" value={itemId} disabled={busy} onChange={e => setItemId(e.target.value)}>
        <option value="">Choose from your catalogue</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.item_type === 'PRODUCT' ? `material, ${i.stock_quantity ?? 0} in stock` : 'service'})</option>)}
      </select></label>
    <label className="space-y-1"><span>Quantity</span><Input className="h-10 w-20" inputMode="numeric" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value)} /></label>
    <Button type="submit" disabled={busy || !ok}>Add</Button>
  </form>;
}

function AddLabour({ staff, busy, onAdd }: { staff: Option[]; busy: boolean; onAdd: (staffId: string, minutes: number) => void }) {
  const [staffId, setStaffId] = React.useState(staff[0]?.id ?? ''), [hours, setHours] = React.useState(''), [minutes, setMinutes] = React.useState('');
  const total = Number(hours || 0) * 60 + Number(minutes || 0);
  const ok = staffId && /^\d{0,3}$/.test(hours) && /^\d{0,3}$/.test(minutes) && total > 0 && total <= 10080;
  return <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (ok) { onAdd(staffId, total); setHours(''); setMinutes(''); } }}>
    <label className="space-y-1"><span>Who</span>
      <select className="h-10 rounded-md border bg-background px-3" value={staffId} disabled={busy} onChange={e => setStaffId(e.target.value)}>
        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
    <label className="space-y-1"><span>Hours</span><Input className="h-10 w-16" inputMode="numeric" value={hours} disabled={busy} onChange={e => setHours(e.target.value)} /></label>
    <label className="space-y-1"><span>Minutes</span><Input className="h-10 w-16" inputMode="numeric" value={minutes} disabled={busy} onChange={e => setMinutes(e.target.value)} /></label>
    <Button type="submit" disabled={busy || !ok}>Record time</Button>
  </form>;
}

function CompleteDialog({ job, lines, items, onClose, onDone }: { job: Job; lines: JobLine[]; items: Map<string, Item>; onClose: () => void; onDone: (figures: JobMoney) => void }) {
  const { attempt, run, reset } = useKeyedRequest();
  const materials = lines.filter(l => items.get(l.catalog_item_id)?.item_type === 'PRODUCT');
  const submit = async () => { const figures = await run(key => completeJobAction(job.id, key)); if (figures) onDone(figures); };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Complete {job.number ?? 'job'}</DialogTitle>
        <DialogDescription>{materials.length ? 'These materials leave stock now, at their cost. The job can no longer change.' : 'The job can no longer change after this.'}</DialogDescription></DialogHeader>
      {materials.length > 0 && <ul className="text-sm">{materials.map(l => <li key={l.id}>{l.quantity} x {items.get(l.catalog_item_id)?.name}</li>)}</ul>}
      {attempt.error && <p role="alert" className="text-sm text-destructive">{attempt.error}</p>}
      <DialogFooter><Button className="w-full" disabled={attempt.busy} onClick={() => void submit()}>{attempt.busy ? 'Completing…' : 'Complete job'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CancelJob({ onClose, onCancel }: { onClose: () => void; onCancel: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState(''), [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Cancel job</DialogTitle><DialogDescription>Nothing has left stock yet. The job stays on record as cancelled.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm"><span>Reason</span><Input maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <DialogFooter><Button className="w-full" variant="destructive" disabled={busy || reason.trim().length < 3}
        onClick={async () => { setBusy(true); await onCancel(reason.trim()); setBusy(false); }}>{busy ? 'Cancelling…' : 'Cancel job'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function InvoiceJob({ job, customers, onClose, onDone }: { job: Job; customers: Option[]; onClose: () => void; onDone: (text: string) => void }) {
  const [customerId, setCustomerId] = React.useState('');
  const { attempt, run, reset } = useKeyedRequest();
  const problem = !job.customer_id && !customerId ? 'Choose the customer to invoice. Add them in Customers if they are new.' : '';
  const submit = async () => {
    const billed = await run(key => billJobByInvoiceAction(job.id, { requestKey: key, customerId: job.customer_id ? undefined : customerId }));
    if (billed) onDone(`Invoice ${billed.invoice_number} issued for ${naira(billed.total)}.`);
  };
  return <Dialog open onOpenChange={o => { if (!o && !attempt.busy) { reset(); onClose(); } }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>Bill by invoice</DialogTitle><DialogDescription>An invoice for the job&apos;s services and materials is issued now. The customer pays it later.</DialogDescription></DialogHeader>
      {!job.customer_id && <label className="space-y-1 text-sm"><span>Customer</span>
        <select className="h-11 w-full rounded-md border bg-background px-3" value={customerId} disabled={attempt.busy || attempt.uncertain} onChange={e => setCustomerId(e.target.value)}>
          <option value="">Choose a customer</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>}
      {(attempt.error || problem) && <p role="alert" className="text-sm text-destructive">{attempt.error || problem}</p>}
      <DialogFooter><Button className="w-full" disabled={attempt.busy || !!problem} onClick={() => void submit()}>{attempt.busy ? 'Issuing…' : 'Issue invoice'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
