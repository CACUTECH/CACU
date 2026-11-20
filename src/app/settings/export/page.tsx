"use client";
// Settings › Export your data (Doc 10 E22 part 2, FR-192): one ZIP of CSV files with everything CACU keeps for the
// business, prepared within the hour and kept seven days. Owners, unless they give someone else the permission.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { exportsAction, requestExportAction } from '@/app/settings/export/actions';
import { EXPORT_STATUS, fileSize, type DataExport } from '@/lib/data-export';

const day = (value: string | null) => value ? new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function ExportPage() {
  const [list, setList] = React.useState<DataExport[] | null>(null);
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [key, setKey] = React.useState(() => crypto.randomUUID());

  const load = React.useCallback(async () => {
    const r = await exportsAction();
    if (r.success) { setList(r.data); setError(''); } else setError(r.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const waiting = !!list?.some(e => e.status === 'queued' || e.status === 'running');
  React.useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const prepare = async () => {
    setBusy(true); setError(''); setMessage('');
    const r = await requestExportAction(key);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setKey(crypto.randomUUID());
    setMessage('Your export is being prepared. It is usually ready within the hour; this page updates by itself.');
    await load();
  };

  return <div className="max-w-3xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Export your data</h1>
      <p className="text-muted-foreground">Download everything CACU keeps for your business, as spreadsheet files (CSV) in one ZIP: sales, invoices, customers, suppliers, stock, purchases, staff, payroll, appointments and your full books with a general ledger.</p></div>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>It works even while your subscription is unpaid.</li>
      <li>The file is kept for 7 days, then deleted. Only people allowed to export in this business can download it.</li>
      <li>Passwords, payment keys and link codes are never included.</li>
    </ul>
    <Button type="button" disabled={busy || waiting || list === null} onClick={() => void prepare()}>{busy ? 'Starting…' : waiting ? 'Export being prepared' : 'Prepare export'}</Button>
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {list === null && !error && <p role="status">Loading…</p>}
    {list && list.length > 0 && <section aria-label="Recent exports" className="space-y-2">
      <h2 className="font-semibold">Recent exports</h2>
      <ul className="space-y-2">{list.map(e => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
        <div><p className="font-medium">{EXPORT_STATUS[e.status]}</p>
          <p className="text-muted-foreground">Asked {day(e.requested_at)}{e.status === 'ready' && e.expires_at ? ` · kept until ${day(e.expires_at)}` : ''}
            {e.manifest ? ` · ${e.manifest.files} files, ${e.manifest.rows.toLocaleString('en-NG')} rows` : ''}{e.size_bytes ? ` · ${fileSize(e.size_bytes)}` : ''}</p>
          {e.error && <p className="text-amber-700">{e.error}</p>}</div>
        {e.status === 'ready' && <Button asChild size="sm"><a href={`/api/exports/${e.id}`} download>Download</a></Button>}
      </li>)}</ul>
    </section>}
  </div>;
}
