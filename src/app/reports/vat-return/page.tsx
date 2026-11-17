"use client";
// Reports › VAT return (Doc 09 PR-32; E14 R3 part 2a): a month's sales and purchases by VAT class, the VAT on each,
// and what is payable, checked against the ledger. Prepared for the owner to check before filing; CACU does not file.
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vatReturnAction } from '@/app/settings/taxes/actions';
import { naira, type VatReturn, type VatSide } from '@/lib/vat';

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
      <p className="text-lg font-semibold">VAT payable for the month: {naira(report.payable)}</p>
      {report.exceptions.length > 0 && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">These figures do not agree with the books. Check them before filing:</p>
        <ul className="list-disc pl-5">{report.exceptions.map(e => <li key={e}>{e}</li>)}</ul></div>}
      <p className="text-sm text-muted-foreground">{report.note}</p>
    </>}
  </div>;
}
