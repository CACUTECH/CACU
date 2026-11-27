"use client";
// Accounting › Fixed Assets (R4; IAS 16). The register of what the business owns for the long term, what it has cost,
// its depreciation and what it is worth in the books. Each month's depreciation is posted by a deliberate step, months
// in order; month close waits for it. Only an Owner or Admin adds, depreciates or disposes of assets.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/components/business-provider';
import { CapitalAllowances } from '@/components/fixed-assets/capital-allowances';
import { addAssetAction, disposeAssetAction, fixedAssetsAction, postDepreciationAction, previewDepreciationAction, removeAssetAction } from '@/app/accounting/fixed-assets/actions';
import { CATEGORIES, methodLabel, monthLabel, monthlyStraightLine, naira, type AssetInput, type DepreciationPreview, type FixedAsset, type FixedAssets } from '@/lib/fixed-assets';

type View = FixedAssets & { suppliers: { id: string; name: string }[] };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const select = 'h-9 w-full rounded-md border bg-background px-2 text-sm';
const HOW = { paid: 'Paid', credit: 'On credit', existing: 'Owned before CACU' } as const;
const blank = (): AssetInput => ({ name: '', category: 'computers', acquired_on: today(), cost: '', residual: '0', method: 'straight_line',
  useful_life_months: 36, annual_rate_percent: '25', how: 'paid', vat: '0', pay_method: 'Cash', bank_account_id: null, supplier_id: null, bill_number: '',
  accumulated_depreciation: '0', brought_in_on: today() });

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function PayFrom({ prefix, method, bank, banks, onChange }: { prefix: string; method: string | null | undefined; bank: string | null | undefined;
  banks: { id: string; name: string }[]; onChange: (method: 'Cash' | 'Transfer', bank: string | null) => void }) {
  return <Field id={`${prefix}-from`} label={prefix === 'sold' ? 'Money went into' : 'Paid from'}>
    <select id={`${prefix}-from`} className={select} value={method === 'Transfer' ? bank ?? '' : 'Cash'}
      onChange={e => e.target.value === 'Cash' ? onChange('Cash', null) : onChange('Transfer', e.target.value)}>
      <option value="Cash">The till (cash)</option>
      {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select></Field>;
}

function AddAsset({ view, onAdded }: { view: View; onAdded: (a: FixedAsset) => void }) {
  const [form, setForm] = React.useState<AssetInput>(blank);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const set = (change: Partial<AssetInput>) => setForm(f => ({ ...f, ...change }));
  const monthly = form.method === 'straight_line' ? monthlyStraightLine(form.cost, form.residual, form.useful_life_months) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const r = await addAssetAction(key, form);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    onAdded(r.data); setForm(blank()); setKey(crypto.randomUUID());
  };

  return <form onSubmit={e => void submit(e)} aria-label="Add an asset" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field id="asset-name" label="Asset"><Input id="asset-name" value={form.name} maxLength={120} placeholder="Delivery van, freezer, laptop…" onChange={e => set({ name: e.target.value })} /></Field>
    <Field id="asset-category" label="Kind of asset">
      <select id="asset-category" className={select} value={form.category} onChange={e => set({ category: e.target.value as AssetInput['category'] })}>
        {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
    <Field id="asset-reference" label="Serial or tag number (optional)"><Input id="asset-reference" value={form.reference ?? ''} maxLength={60} onChange={e => set({ reference: e.target.value })} /></Field>

    <Field id="asset-how" label="How it was bought">
      <select id="asset-how" className={select} value={form.how} onChange={e => set({ how: e.target.value as AssetInput['how'] })}>
        <option value="paid">Paid for now</option><option value="credit">On credit from a supplier</option><option value="existing">Owned before CACU</option>
      </select></Field>
    <Field id="asset-date" label="Date bought"><Input id="asset-date" type="date" max={today()} value={form.acquired_on} onChange={e => set({ acquired_on: e.target.value })} /></Field>
    <Field id="asset-cost" label={form.how === 'existing' ? 'Cost (₦)' : 'Cost before VAT (₦)'}><Input id="asset-cost" inputMode="decimal" value={form.cost} onChange={e => set({ cost: e.target.value })} /></Field>
    {form.how !== 'existing' && <Field id="asset-vat" label="VAT on the bill (₦)" hint="Only if your business is registered for VAT; it is claimed in your VAT return. Otherwise leave 0 and include VAT in the cost.">
      <Input id="asset-vat" inputMode="decimal" value={form.vat ?? ''} onChange={e => set({ vat: e.target.value })} /></Field>}

    {form.how === 'paid' && <PayFrom prefix="bought" method={form.pay_method} bank={form.bank_account_id} banks={view.pay_from.banks}
      onChange={(pay_method, bank_account_id) => set({ pay_method, bank_account_id })} />}
    {form.how === 'credit' && <>
      <Field id="asset-supplier" label="Supplier">
        <select id="asset-supplier" className={select} value={form.supplier_id ?? ''} onChange={e => set({ supplier_id: e.target.value || null })}>
          <option value="">Choose…</option>{view.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></Field>
      <Field id="asset-bill" label="Their bill number"><Input id="asset-bill" value={form.bill_number ?? ''} maxLength={100} onChange={e => set({ bill_number: e.target.value })} /></Field>
    </>}
    {form.how === 'existing' && <>
      <Field id="asset-brought" label="Bring into the books on" hint="On or after the day your books started in CACU.">
        <Input id="asset-brought" type="date" max={today()} value={form.brought_in_on ?? ''} onChange={e => set({ brought_in_on: e.target.value })} /></Field>
      <Field id="asset-accumulated" label="Depreciation to date (₦)" hint="Up to the day your books started in CACU. Months since then are charged by the monthly depreciation.">
        <Input id="asset-accumulated" inputMode="decimal" value={form.accumulated_depreciation ?? ''} onChange={e => set({ accumulated_depreciation: e.target.value })} /></Field>
    </>}

    <Field id="asset-method" label="Depreciation">
      <select id="asset-method" className={select} value={form.method} onChange={e => set({ method: e.target.value as AssetInput['method'] })}>
        <option value="straight_line">Straight-line (the same each month)</option><option value="reducing_balance">Reducing balance (a rate on what is left)</option>
      </select></Field>
    {form.method === 'straight_line'
      ? <Field id="asset-life" label="Useful life (months)" hint={monthly ? `About ${naira(monthly)} a month.` : undefined}>
          <Input id="asset-life" type="number" min={1} max={1200} value={form.useful_life_months ?? ''} onChange={e => set({ useful_life_months: e.target.value ? Number(e.target.value) : null })} /></Field>
      : <Field id="asset-rate" label="Yearly rate (%)"><Input id="asset-rate" inputMode="decimal" value={form.annual_rate_percent ?? ''} onChange={e => set({ annual_rate_percent: e.target.value })} /></Field>}
    <Field id="asset-residual" label="Worth at the end (₦)" hint="What you expect to sell it for when you are done with it."><Input id="asset-residual" inputMode="decimal" value={form.residual} onChange={e => set({ residual: e.target.value })} /></Field>

    <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
      <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add asset'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </form>;
}

function DisposeForm({ asset, view, onDone, onCancel }: { asset: FixedAsset; view: View; onDone: (a: FixedAsset) => void; onCancel: () => void }) {
  const [on, setOn] = React.useState(today()), [proceeds, setProceeds] = React.useState('0'), [vat, setVat] = React.useState('0');
  const [method, setMethod] = React.useState<'Cash' | 'Transfer'>('Cash'), [bank, setBank] = React.useState<string | null>(null);
  const [key] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const result = Number(proceeds || 0) - Number(asset.carrying_amount);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const r = await disposeAssetAction(asset.id, key, { disposed_on: on, proceeds: proceeds || '0', vat: vat || '0', method, bank_account_id: bank });
    setBusy(false);
    if (r.success) onDone(r.data); else setError(r.error);
  };
  return <form onSubmit={e => void submit(e)} aria-label={`Dispose of ${asset.name}`} className="grid gap-3 rounded-md border bg-muted/40 p-3 sm:grid-cols-3">
    <p className="text-sm sm:col-span-3">Selling or scrapping <span className="font-medium">{asset.name}</span>, worth {naira(asset.carrying_amount)} in the books.
      {Number.isFinite(result) && result !== 0 && <> That is a {result > 0 ? 'gain' : 'loss'} of {naira(Math.abs(result))}.</>}</p>
    <Field id="sold-on" label="Date"><Input id="sold-on" type="date" max={today()} value={on} onChange={e => setOn(e.target.value)} /></Field>
    <Field id="sold-for" label="Sold for, before VAT (₦)" hint="0 if it was scrapped or given away."><Input id="sold-for" inputMode="decimal" value={proceeds} onChange={e => setProceeds(e.target.value)} /></Field>
    {Number(proceeds) > 0 && <Field id="sold-vat" label="VAT charged (₦)" hint="Only if your business is registered for VAT: 7.5% of the price, or 0 for an exempt sale such as land.">
      <Input id="sold-vat" inputMode="decimal" value={vat} onChange={e => setVat(e.target.value)} /></Field>}
    {Number(proceeds) > 0 && <PayFrom prefix="sold" method={method} bank={bank} banks={view.pay_from.banks} onChange={(m, b) => { setMethod(m); setBank(b); }} />}
    <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
      <Button type="submit" size="sm" disabled={busy}>{busy ? 'Recording…' : 'Record disposal'}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </form>;
}

function RemoveForm({ asset, onDone, onCancel }: { asset: FixedAsset; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = React.useState('');
  const [key] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const r = await removeAssetAction(asset.id, key, reason);
    setBusy(false);
    if (r.success) onDone(); else setError(r.error);
  };
  return <form onSubmit={e => void submit(e)} aria-label={`Remove ${asset.name}`} className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
    <p>Remove <span className="font-medium">{asset.name}</span> as entered in error? Its purchase, depreciation and any sale are each reversed by a journal dated today, and it leaves the register. The original entries stay in the books.</p>
    <Input aria-label="Why it is being removed" placeholder="Why it is being removed" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" variant="destructive" disabled={busy}>{busy ? 'Removing…' : 'Remove asset'}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  </form>;
}

export default function FixedAssetsPage() {
  const { business } = useBusiness();
  const manager = ['owner', 'admin'].includes(business?.userRole ?? '');
  const owner = business?.userRole === 'owner';
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [disposing, setDisposing] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<DepreciationPreview | null>(null);
  const [postKey, setPostKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    const r = await fixedAssetsAction();
    if (r.success) setView(r.data); else { setView(null); setLoadError(r.error); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  const due = view?.due[0] ?? null;
  React.useEffect(() => {
    setPreview(null);
    if (due && manager) void previewDepreciationAction(due).then(r => { if (r.success) setPreview(r.data); });
  }, [due, manager]);

  const post = async () => {
    if (!due) return;
    setBusy(true); setError(''); setMessage('');
    const r = await postDepreciationAction(due, postKey);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setMessage(`Depreciation for ${monthLabel(due)} posted: ${naira(r.data.total)}.`); setPostKey(crypto.randomUUID());
    await load();
  };

  const heading = <div className="flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="font-headline text-3xl font-bold">Fixed assets</h1>
      <p className="text-muted-foreground">What the business owns for the long term, its depreciation and what it is worth in the books.</p></div>
    {manager && view && <Button onClick={() => setAdding(a => !a)} variant={adding ? 'outline' : 'default'}>{adding ? 'Close' : 'Add an asset'}</Button>}
  </div>;
  if (view === undefined) return <div className="space-y-4">{heading}<p role="status">Loading…</p></div>;
  if (view === null) return <div className="space-y-4">{heading}<p role="alert">{loadError}</p></div>;
  const live = view.assets.filter(a => !a.disposed_on), gone = view.assets.filter(a => a.disposed_on);

  return <div className="space-y-6">
    {heading}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {due && <Card className="border-amber-500"><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
      <div><p className="font-medium">Depreciation for {monthLabel(due)} is not posted yet</p>
        <p className="text-muted-foreground">{view.due.length > 1 ? `${view.due.length} months are waiting; they are posted in order. ` : ''}The month cannot be closed until it is.
          {preview && ` This month: ${naira(preview.total)} across ${preview.charges.length} asset${preview.charges.length === 1 ? '' : 's'}.`}</p></div>
      {manager && <Button onClick={() => void post()} disabled={busy}>{busy ? 'Posting…' : `Post ${monthLabel(due)}`}</Button>}
      {error && <p role="alert" className="w-full text-destructive">{error}</p>}
    </CardContent></Card>}

    {adding && manager && <Card><CardHeader><CardTitle>Add an asset</CardTitle></CardHeader><CardContent>
      <AddAsset view={view} onAdded={a => { setMessage(`${a.name} added.`); setAdding(false); void load(); }} />
    </CardContent></Card>}

    <div className="grid gap-4 sm:grid-cols-3">
      {([['Cost', view.totals.cost], ['Depreciation to date', view.totals.accumulated_depreciation], ['Worth in the books', view.totals.carrying_amount]] as const).map(([label, value]) =>
        <Card key={label}><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{naira(value)}</p></CardContent></Card>)}
    </div>

    <Card><CardHeader><CardTitle>Register</CardTitle></CardHeader><CardContent className="space-y-3">
      {live.length === 0 && <p className="text-sm text-muted-foreground">No assets yet. Add the equipment, furniture, vehicles and buildings the business owns.</p>}
      {live.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-3">Asset</th><th className="pr-3">Bought</th>
          <th className="pr-3 text-right">Cost</th><th className="pr-3 text-right">Depreciation</th><th className="pr-3 text-right">Worth now</th><th /></tr></thead>
        <tbody>{live.map(a => <React.Fragment key={a.id}><tr className="border-b align-top">
          <td className="py-2 pr-3"><span className="font-medium">{a.name}</span>
            <span className="block text-xs text-muted-foreground">{a.category_name}{a.reference ? ` · ${a.reference}` : ''} · {methodLabel(a)}</span></td>
          <td className="pr-3">{new Date(a.acquired_on).toLocaleDateString('en-NG')}<span className="block text-xs text-muted-foreground">{HOW[a.how]}</span></td>
          <td className="pr-3 text-right tabular-nums">{naira(a.cost)}</td>
          <td className="pr-3 text-right tabular-nums">{naira(a.accumulated_depreciation)}</td>
          <td className="pr-3 text-right font-medium tabular-nums">{naira(a.carrying_amount)}</td>
          <td className="space-x-1 text-right">{manager && disposing !== a.id && <Button size="sm" variant="outline" onClick={() => setDisposing(a.id)}>Sell or scrap</Button>}
            {owner && removing !== a.id && <Button size="sm" variant="ghost" onClick={() => setRemoving(a.id)}>Entered in error</Button>}</td>
        </tr>
          {removing === a.id && <tr><td colSpan={6} className="py-2"><RemoveForm asset={a} onCancel={() => setRemoving(null)}
            onDone={() => { setRemoving(null); setMessage(`${a.name} removed, and everything it put in the books reversed.`); void load(); }} /></td></tr>}
          {disposing === a.id && <tr><td colSpan={6} className="py-2">
            <DisposeForm asset={a} view={view} onCancel={() => setDisposing(null)}
              onDone={d => { setDisposing(null); setMessage(`${d.name} taken out of the books${d.disposal_result && Number(d.disposal_result) !== 0 ? `, with a ${Number(d.disposal_result) > 0 ? 'gain' : 'loss'} of ${naira(Math.abs(Number(d.disposal_result)))}` : ''}.`); void load(); }} />
          </td></tr>}
        </React.Fragment>)}</tbody>
      </table></div>}
    </CardContent></Card>

    {gone.length > 0 && <Card><CardHeader><CardTitle>Sold or scrapped</CardTitle></CardHeader><CardContent>
      <ul className="space-y-1 text-sm">{gone.map(a => <li key={a.id}><span className="font-medium">{a.name}</span> · {new Date(a.disposed_on!).toLocaleDateString('en-NG')} ·
        sold for {naira(a.disposal_proceeds ?? 0)}{a.disposal_result && Number(a.disposal_result) !== 0 && ` (${Number(a.disposal_result) > 0 ? 'gain' : 'loss'} ${naira(Math.abs(Number(a.disposal_result)))})`}</li>)}</ul>
    </CardContent></Card>}

    {view.capital_allowances && view.assets.length > 0 && <CapitalAllowances manager={manager}
      firstYear={Math.min(...view.assets.map(a => Number(a.depreciate_from.slice(0, 4))))} />}

    {view.runs.length > 0 && <Card><CardHeader><CardTitle>Depreciation posted</CardTitle></CardHeader><CardContent>
      <ul className="space-y-1 text-sm">{view.runs.map(r => <li key={r.month} className="flex justify-between gap-3"><span>{monthLabel(r.month)}</span>
        <span className="tabular-nums">{naira(r.total)}</span></li>)}</ul>
    </CardContent></Card>}
  </div>;
}
