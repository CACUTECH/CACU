"use client";
// Settings › Taxes (Doc 12 SCR-24; Doc 09 PR-32; E14 R3 part 2a). VAT is off unless the business is VAT-registered.
// Then 7.5% on standard-rated items; till prices include VAT; each invoice says whether its prices do.
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveVatAction, saveVatClassesAction, vatAction } from '@/app/settings/taxes/actions';
import { percent, validVatNumber, VAT_CLASS_LABELS, type VatClass, type VatOverview } from '@/lib/vat';

export default function TaxSettingsPage() {
  const [view, setView] = React.useState<VatOverview | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState('');
  const [registered, setRegistered] = React.useState(false), [number, setNumber] = React.useState('');
  const [from, setFrom] = React.useState(''), [inclusive, setInclusive] = React.useState(false), [wht, setWht] = React.useState(false);
  const [classes, setClasses] = React.useState<Record<string, VatClass>>({});
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const show = (data: VatOverview) => {
    setView(data); setRegistered(data.registered); setNumber(data.vat_number ?? ''); setFrom(data.effective_from ?? '');
    setInclusive(data.invoices_include_vat); setWht(data.wht_enabled); setClasses(Object.fromEntries(data.items.map(i => [i.id, i.vat_class])));
  };
  React.useEffect(() => { void vatAction().then(r => { if (r.success) show(r.data); else { setView(null); setLoadError(r.error); } }); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (registered && !validVatNumber(number)) { setError('Enter your VAT number (6 to 20 letters, digits or dashes).'); return; }
    if (registered && !from) { setError('Enter the date you started charging VAT.'); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await saveVatAction({ registered, vat_number: registered ? number.trim() : null, effective_from: registered ? from : null, invoices_include_vat: inclusive, wht_enabled: wht });
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    show(r.data); setMessage(r.data.registered ? 'VAT is on. New sales and invoices from that date include VAT.' : 'VAT is off. New sales and invoices carry no VAT.');
  };
  const saveClasses = async () => {
    if (!view) return;
    const changed = view.items.filter(i => classes[i.id] !== i.vat_class).map(i => ({ item_id: i.id, vat_class: classes[i.id] }));
    if (!changed.length) { setMessage('No changes to save.'); return; }
    setBusy(true); setError(''); setMessage('');
    const r = await saveVatClassesAction(changed);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    show(r.data); setMessage(`${changed.length} item${changed.length === 1 ? '' : 's'} updated.`);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Tax Settings</h1>
    <p className="text-muted-foreground">Value added tax (VAT) on what you sell.</p></div>;
  if (view === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (view === null) return <div className="space-y-4">{heading}<p role="alert">{loadError}</p></div>;

  return <div className="max-w-3xl space-y-6">{heading}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <form onSubmit={e => void save(e)} className="space-y-4 rounded-xl border p-4" aria-label="VAT registration">
      <h2 className="font-semibold">VAT registration</h2>
      <p className="text-sm text-muted-foreground">Small businesses below the turnover threshold do not charge VAT. Turn this on only if you are registered for VAT.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={registered} disabled={busy} onChange={e => setRegistered(e.target.checked)} />
        My business is registered for VAT and charges it</label>
      {registered && <>
        <div className="space-y-1"><Label htmlFor="vat-number">VAT number (TIN)</Label>
          <Input id="vat-number" value={number} maxLength={20} disabled={busy} onChange={e => setNumber(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="vat-from">Charging VAT from</Label>
          <Input id="vat-from" type="date" value={from} disabled={busy} onChange={e => setFrom(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inclusive} disabled={busy} onChange={e => setInclusive(e.target.checked)} />
          Invoice prices already include VAT (you can change this on each invoice)</label>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Standard rate: {percent(view.standard_rate)}. Mark items below as zero-rated or exempt where the law says so.</li>
          <li>Till prices include VAT: the customer pays the price on the shelf, and CACU works out the VAT inside it.</li>
          <li>Sales and invoices already recorded are not changed.</li>
        </ul>
      </>}
      <div className="space-y-1 border-t pt-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={wht} disabled={busy} onChange={e => setWht(e.target.checked)} />
          Some customers deduct withholding tax (WHT) before paying</label>
        <p className="text-sm text-muted-foreground">Record the WHT with their payment; CACU keeps it as a tax credit (account 1320) and lists it for their certificates.
          How WHT credits are treated is still to be confirmed by our accountant reviewer.</p>
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>

    {view.registered && <section aria-label="VAT on items" className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">VAT on each item</h2>
      {view.items.length === 0 ? <p className="text-sm">Add products or services first.</p> :
        <ul className="divide-y text-sm">{view.items.map(item =>
          <li key={item.id} className="flex items-center justify-between gap-3 py-2"><span>{item.name}</span>
            <select aria-label={`VAT on ${item.name}`} className="rounded-md border bg-background p-1" value={classes[item.id]} disabled={busy}
              onChange={e => setClasses(c => ({ ...c, [item.id]: e.target.value as VatClass }))}>
              {(Object.keys(VAT_CLASS_LABELS) as VatClass[]).map(k => <option key={k} value={k}>{VAT_CLASS_LABELS[k]}</option>)}
            </select></li>)}</ul>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => void saveClasses()}>Save item VAT</Button>
      <p className="text-sm"><Link className="underline" href="/reports/vat-return">See the VAT return</Link></p>
    </section>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
