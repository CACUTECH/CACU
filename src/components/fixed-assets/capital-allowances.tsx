"use client";
// Capital allowances (R4; Nigeria Tax Act 2025): tax depreciation on the register for a tax year, kept apart from book
// depreciation, for the company income tax computation. Nothing here posts to the books. Shown only while CACU has
// it on (for now, the preview business), with the rates marked for a tax professional to confirm.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { capitalAllowancesAction, saveAssetTaxAction } from '@/app/accounting/fixed-assets/actions';
import { naira, type AllowanceRow, type CapitalAllowances as Allowances } from '@/lib/fixed-assets';

const select = 'h-9 w-full rounded-md border bg-background px-2 text-sm';

function TaxForm({ row, data, onSaved, onCancel }: { row: AllowanceRow; data: Allowances; onSaved: () => void; onCancel: () => void }) {
  const [taxClass, setTaxClass] = React.useState(row.tax_class);
  const [qualifies, setQualifies] = React.useState(row.qualifies);
  const [claimed, setClaimed] = React.useState(row.claimed_before);
  const [note, setNote] = React.useState(row.note ?? '');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const r = await saveAssetTaxAction(row.asset_id, { tax_class: taxClass, qualifies, claimed_before: claimed || '0', note });
    setBusy(false);
    if (r.success) onSaved(); else setError(r.error);
  };
  return <form onSubmit={e => void submit(e)} aria-label={`Tax treatment of ${row.name}`} className="grid gap-3 rounded-md border bg-muted/40 p-3 sm:grid-cols-2">
    <div className="space-y-1"><Label htmlFor={`class-${row.asset_id}`}>Class</Label>
      <select id={`class-${row.asset_id}`} className={select} value={taxClass} onChange={e => setTaxClass(e.target.value)}>
        {data.classes.map(c => <option key={c.tax_class} value={c.tax_class}>{c.label} ({Number(c.rate_percent)}%)</option>)}
      </select></div>
    <div className="space-y-1"><Label htmlFor={`claimed-${row.asset_id}`}>Allowances already claimed before CACU (₦)</Label>
      <Input id={`claimed-${row.asset_id}`} inputMode="decimal" value={claimed} onChange={e => setClaimed(e.target.value)} /></div>
    <label className="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" checked={qualifies} onChange={e => setQualifies(e.target.checked)} />
      VAT was charged on it (or import duty paid), so it qualifies
    </label>
    <div className="space-y-1 sm:col-span-2"><Label htmlFor={`note-${row.asset_id}`}>Note (optional)</Label>
      <Input id={`note-${row.asset_id}`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></div>
    <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </form>;
}

export function CapitalAllowances({ manager, firstYear }: { manager: boolean; firstYear: number }) {
  // Up to next year: with a year end before December, the tax year in progress ends next year.
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: Math.max(thisYear + 1 - Math.max(firstYear, 2026) + 1, 1) }, (_, i) => thisYear + 1 - i).filter(y => y >= 2026);
  const [year, setYear] = React.useState(Math.max(thisYear, 2026));
  const [data, setData] = React.useState<Allowances | null | undefined>(undefined);
  const [error, setError] = React.useState('');
  const [editing, setEditing] = React.useState<string | null>(null);

  const load = React.useCallback(async (y: number) => {
    const r = await capitalAllowancesAction(y);
    if (r.success) { setData(r.data); setError(''); } else { setData(null); setError(r.error); }
  }, []);
  React.useEffect(() => { void load(year); }, [year, load]);

  return <Card aria-label="Capital allowances"><CardHeader><CardTitle>Capital allowances (tax)</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">Tax depreciation on these assets under the Nigeria Tax Act 2025, for your company income tax computation.
        It is separate from the depreciation in your books and does not change them.</p>
      <div className="flex items-center gap-2"><Label htmlFor="allowance-year">Tax year</Label>
        <select id="allowance-year" className="h-9 rounded-md border bg-background px-2" value={year} onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select></div>
      {data === undefined && <p role="status">Working it out…</p>}
      {data === null && <p role="alert">{error}</p>}
      {data && <>
        {!data.reviewed && <p role="note" className="rounded-md border border-amber-500 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          These rates follow CACU&apos;s reading of the Act and are still to be confirmed by a tax professional. Check them with your tax adviser before filing.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {([['Capital allowances', data.totals.allowance], ['Balancing charges (taxable)', data.totals.balancing_charge], ['Balancing allowances', data.totals.balancing_allowance]] as const).map(([label, value]) =>
            <div key={label} className="rounded-md border p-3"><p className="text-muted-foreground">{label}</p><p className="text-lg font-bold tabular-nums">{naira(value)}</p></div>)}
        </div>
        {data.assets.length === 0 ? <p className="text-muted-foreground">No assets held in {data.year}.</p> : <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Asset</th><th className="pr-3">Class</th>
            <th className="pr-3 text-right">Start of year</th><th className="pr-3 text-right">Allowance</th><th className="pr-3 text-right">End of year</th><th /></tr></thead>
          <tbody>{data.assets.map(row => <React.Fragment key={row.asset_id}><tr className="border-b align-top">
            <td className="py-2 pr-3 font-medium">{row.name}{!row.qualifies && <span className="block text-xs font-normal text-muted-foreground">Does not qualify{row.note ? `: ${row.note}` : ''}</span>}
              {row.proceeds != null && <span className="block text-xs font-normal text-muted-foreground">Sold for {naira(row.proceeds)} · balancing {Number(row.balancing) >= 0 ? 'charge' : 'allowance'} {naira(Math.abs(Number(row.balancing)))}</span>}</td>
            <td className="pr-3">{row.class_label}<span className="block text-xs text-muted-foreground">{Number(row.rate_percent)}% a year{row.set ? '' : ' · default'}</span></td>
            <td className="pr-3 text-right tabular-nums">{row.opening != null ? naira(row.opening) : '—'}</td>
            <td className="pr-3 text-right tabular-nums">{row.allowance != null ? naira(row.allowance) : '—'}</td>
            <td className="pr-3 text-right tabular-nums">{row.closing != null ? naira(row.closing) : '—'}</td>
            <td className="text-right">{manager && editing !== row.asset_id && <Button size="sm" variant="outline" onClick={() => setEditing(row.asset_id)}>Tax details</Button>}</td>
          </tr>
            {editing === row.asset_id && <tr><td colSpan={6} className="py-2"><TaxForm row={row} data={data} onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); void load(year); }} /></td></tr>}
          </React.Fragment>)}</tbody>
        </table></div>}
        <p className="text-xs text-muted-foreground">{data.note}</p>
      </>}
    </CardContent></Card>;
}
