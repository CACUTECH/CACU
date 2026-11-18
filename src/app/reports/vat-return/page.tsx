"use client";
// Reports › VAT return (Doc 09 PR-32; E14 R3 part 2a): a month's sales and purchases by VAT class, the VAT on each,
// and what is payable, checked against the ledger. Prepared for the owner to check before filing; CACU does not file.
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { saveWhtCertificateAction, vatReturnAction } from '@/app/settings/taxes/actions';
import { naira, type VatReturn, type VatSide, type WhtDeduction } from '@/lib/vat';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

function Side({ title, side }: { title: string; side: VatSide }) {
  return <section aria-label={title} className="rounded-xl border p-4">
    <h2 className="mb-2 font-semibold">{title} ({side.documents} document{side.documents === 1 ? '' : 's'})</h2>
    <dl className="grid grid-cols-2 gap-1 text-sm">
      <dt>Standard rated, before VAT</dt><dd className="text-right">{naira(side.standard_net)}</dd>
      <dt>Zero-rated</dt><dd className="text-right">{naira(side.zero_rated_net)}</dd>
      <dt>Exempt</dt><dd className="text-right">{naira(side.exempt_net)}</dd>
      <dt className="font-medium">VAT</dt><dd className="text-right font-medium">{naira(side.vat)}</dd>
    </dl>
  </section>;
}

function Certificate({ deduction }: { deduction: WhtDeduction }) {
  const [value, setValue] = React.useState(deduction.certificate ?? ''), [saved, setSaved] = React.useState(deduction.certificate ?? '');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  if (saved) return <span>{saved}</span>;
  return <span className="flex items-center gap-2">
    <Input aria-label={`Certificate for ${deduction.invoice_number ?? 'this deduction'}`} className="h-8 w-40" maxLength={60} value={value} disabled={busy} onChange={e => setValue(e.target.value)} />
    <Button type="button" size="sm" variant="outline" disabled={busy || !value.trim()} onClick={async () => {
      setBusy(true); setError('');
      const r = await saveWhtCertificateAction(deduction.id, value.trim());
      setBusy(false);
      if (r.success) setSaved(r.data.certificate); else setError(r.error);
    }}>Save</Button>{error && <span role="alert" className="text-destructive">{error}</span>}</span>;
}

export default function VatReturnPage() {
  const [month, setMonth] = React.useState(lastMonth);
  const [report, setReport] = React.useState<VatReturn | null>(null), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    void vatReturnAction(month).then(r => {
      if (!current) return;
      setLoading(false);
      if (r.success) { setReport(r.data); setError(''); } else { setReport(null); setError(r.error); }
    });
    return () => { current = false; };
  }, [month]);

  return <div className="max-w-3xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">VAT return</h1>
      <p className="text-muted-foreground">VAT you charged on sales, less VAT you paid on purchases, for one month.</p></div>
    <div className="max-w-xs space-y-1"><Label htmlFor="vat-month">Month</Label>
      <Input id="vat-month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
    {loading ? <p role="status">Loading…</p> : error ? <p role="alert" className="text-destructive">{error}</p> : report && <>
      {report.vat_number && <p className="text-sm">VAT number: {report.vat_number}</p>}
      <Side title="Sales" side={report.sales} />
      <Side title="Purchases" side={report.purchases} />
      <p className="text-lg font-semibold">{Number(report.payable) < 0 ? `VAT reclaimable for the month: ${naira(String(-Number(report.payable)))}` : `VAT payable for the month: ${naira(report.payable)}`}</p>
      {report.wht && report.wht.deductions.length > 0 && <section aria-label="WHT credits" className="space-y-2 rounded-xl border p-4">
        <h2 className="font-semibold">WHT deducted by customers: {naira(report.wht.total)}</h2>
        {!report.wht.reviewed && <p className="text-sm text-amber-900">How WHT credits are treated is still to be confirmed by our accountant reviewer.</p>}
        <ul className="divide-y text-sm">{report.wht.deductions.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>{d.date} · {d.customer ?? 'Customer'} · {d.invoice_number ?? ''} · {naira(d.amount)}</span><Certificate deduction={d} /></li>)}</ul>
      </section>}
      {report.exceptions.length > 0 && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">These figures do not agree with the books. Check them before filing:</p>
        <ul className="list-disc pl-5">{report.exceptions.map(e => <li key={e}>{e}</li>)}</ul></div>}
      <p className="text-sm text-muted-foreground">{report.note}</p>
    </>}
  </div>;
}
