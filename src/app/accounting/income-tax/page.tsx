"use client";
// Accounting › Income Tax Estimate (R4; Nigeria Tax Act 2025). A yearly estimate of companies income tax and the
// development levy from the books, every step shown, for the owner and their tax adviser. Nothing posts and CACU files
// nothing. Off until a tax professional reviews it; on for CACU's preview business.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/components/business-provider';
import { addTaxAdjustmentAction, bankAccountsAction, incomeTaxAction, removeTaxAdjustmentAction, saveTaxYearAction, saveYearEndAction } from '@/app/accounting/income-tax/actions';
import { naira } from '@/lib/fixed-assets';
import { TaxBooks } from '@/components/income-tax/tax-books';
import type { IncomeTaxEstimate } from '@/lib/income-tax';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
const TOTALS = new Set(['Profit before tax, from the books', 'Adjusted profit', 'Assessable profit', 'Total profits']);

export default function IncomeTaxPage() {
  const { business } = useBusiness();
  const manager = ['owner', 'admin'].includes(business?.userRole ?? '');
  const thisYear = new Date().getFullYear();
  // Up to next year: with a year end before December, the current tax year ends next year.
  const years = Array.from({ length: thisYear - 2026 + 2 }, (_, i) => thisYear + 1 - i).filter(y => y >= 2026);
  const [year, setYear] = React.useState(thisYear >= 2026 ? thisYear : 2026);
  const [reload, setReload] = React.useState(0);
  const [banks, setBanks] = React.useState<{ id: string; name: string }[]>([]);
  const [view, setView] = React.useState<IncomeTaxEstimate | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState('');
  const [losses, setLosses] = React.useState('0'), [professional, setProfessional] = React.useState(false);
  const [adj, setAdj] = React.useState<{ direction: 'add' | 'deduct'; label: string; amount: string }>({ direction: 'add', label: '', amount: '' });
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  const show = (data: IncomeTaxEstimate) => {
    setView(data); setLosses(data.told.losses_brought_forward); setProfessional(data.told.professional_services);
  };
  React.useEffect(() => {
    setView(undefined);
    void incomeTaxAction(year).then(r => { if (r.success) show(r.data); else { setView(null); setLoadError(r.error); } });
  }, [year, reload]);
  React.useEffect(() => { void bankAccountsAction().then(r => { if (r.success) setBanks(r.data); }); }, []);

  const run = async (work: () => ReturnType<typeof incomeTaxAction>, after?: () => void) => {
    setBusy(true); setError('');
    const r = await work();
    setBusy(false);
    if (r.success) { show(r.data); after?.(); } else setError(r.error);
  };

  const heading = <div><h1 className="font-headline text-3xl font-bold">Income tax estimate</h1>
    <p className="text-muted-foreground">Companies income tax and the development levy for the year, worked out from your books.</p></div>;
  if (view === undefined) return <div className="space-y-4">{heading}<p role="status">Working it out…</p></div>;
  if (view === null) return <div className="space-y-4">{heading}<p role="alert">{loadError}</p></div>;

  return <div className="space-y-6">
    {heading}
    <div className="flex items-center gap-2"><Label htmlFor="tax-year">Tax year</Label>
      <select id="tax-year" className="h-9 rounded-md border bg-background px-2 text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="text-sm text-muted-foreground">{day(view.period.start)} to {day(view.period.end)}</span></div>
    {!view.reviewed && <p role="note" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      This follows CACU&apos;s reading of the Nigeria Tax Act 2025 and is still to be confirmed by a tax professional. Check it with your tax adviser before you file.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    <Card><CardContent className="space-y-2 pt-6">
      {view.small_company
        ? <><p className="text-lg font-bold">A small company: no income tax or development levy for {view.year}</p>
            <p className="text-sm text-muted-foreground">Turnover {naira(view.turnover)} (up to {naira(view.small_turnover)}) and fixed assets {naira(view.fixed_assets)} (up to {naira(view.small_fixed_assets)}). You still file a return.</p></>
        : <><p className="text-sm text-muted-foreground">Estimated for {view.year}</p>
            <p className="text-3xl font-bold tabular-nums">{naira(view.total_due)}</p>
            <p className="text-sm">Companies income tax {naira(view.companies_income_tax)} ({Number(view.cit_rate_percent)}% of total profits) · development levy {naira(view.development_levy)} ({Number(view.levy_rate_percent)}% of assessable profit)</p>
            {Number(view.wht.used) > 0 && <p className="text-sm">Less withholding tax your customers deducted (with credit notes): {naira(view.wht.used)}, leaving income tax of {naira(view.income_tax_to_pay)}.</p>}
            <p className="text-sm text-muted-foreground">Not a small company because {view.not_small_because.join(' and ')}.</p></>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>How it is worked out</CardTitle></CardHeader><CardContent>
      <table className="w-full text-sm"><tbody>{view.steps.map(s => <tr key={s.label} className={TOTALS.has(s.label) ? 'border-t font-medium' : ''}>
        <td className="py-1.5 pr-3">{s.label}</td><td className="py-1.5 text-right tabular-nums">{naira(s.amount)}</td></tr>)}</tbody></table>
      {view.wht.awaiting_count > 0 && <p className="mt-3 text-sm text-muted-foreground">
        {naira(view.wht.awaiting_certificate)} of withholding tax on {view.wht.awaiting_count} invoice{view.wht.awaiting_count === 1 ? '' : 's'} is waiting for the customer&apos;s credit note. Add the credit note number on the invoice to count it.</p>}
      {Number(view.wht.carried_forward) > 0 && <p className="mt-3 text-sm text-muted-foreground">Withholding tax credits of {naira(view.wht.carried_forward)} are more than the tax and carry forward.</p>}
      {(Number(view.losses_carried_forward) > 0 || Number(view.allowances_carried_forward) > 0) && <p className="mt-3 text-sm text-muted-foreground">
        Carried to next year: losses {naira(view.losses_carried_forward)}, unused capital allowances {naira(view.allowances_carried_forward)}.</p>}
    </CardContent></Card>

    <TaxBooks view={view} role={business?.userRole ?? ''} banks={banks} onChange={show} />

    <Card><CardHeader><CardTitle>Adjustments</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">Add back spending the law does not allow (fines, penalties, private spending) and take off income that is not taxable. Your tax adviser can tell you what applies.</p>
      {view.adjustments.length > 0 && <ul className="space-y-1">{view.adjustments.map(a => <li key={a.id} className="flex items-center justify-between gap-2">
        <span>{a.direction === 'add' ? 'Add back' : 'Take off'}: {a.label} · <span className="tabular-nums">{naira(a.amount)}</span></span>
        {manager && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => removeTaxAdjustmentAction(year, a.id))}>Remove</Button>}</li>)}</ul>}
      {manager && <form aria-label="Add an adjustment" className="grid gap-2 sm:grid-cols-4" onSubmit={e => { e.preventDefault();
        void run(() => addTaxAdjustmentAction(year, key, adj), () => { setAdj({ direction: 'add', label: '', amount: '' }); setKey(crypto.randomUUID()); }); }}>
        <select aria-label="Add back or take off" className="h-9 rounded-md border bg-background px-2" value={adj.direction} onChange={e => setAdj(a => ({ ...a, direction: e.target.value as 'add' | 'deduct' }))}>
          <option value="add">Add back</option><option value="deduct">Take off</option></select>
        <Input aria-label="What it is" placeholder="What it is" value={adj.label} maxLength={120} onChange={e => setAdj(a => ({ ...a, label: e.target.value }))} />
        <Input aria-label="Amount (₦)" placeholder="Amount (₦)" inputMode="decimal" value={adj.amount} onChange={e => setAdj(a => ({ ...a, amount: e.target.value }))} />
        <Button type="submit" disabled={busy}>Add</Button>
      </form>}
    </CardContent></Card>

    {manager && <Card><CardHeader><CardTitle>About this year</CardTitle></CardHeader><CardContent>
      <form aria-label="About this year" className="grid gap-3 text-sm sm:grid-cols-2" onSubmit={e => { e.preventDefault();
        void run(() => saveTaxYearAction(year, { losses_brought_forward: losses || '0', professional_services: professional })); }}>
        <div className="space-y-1"><Label htmlFor="losses">Losses brought forward (₦)</Label>
          <Input id="losses" inputMode="decimal" value={losses} onChange={e => setLosses(e.target.value)} />
          <p className="text-xs text-muted-foreground">Tax losses from earlier years not yet used, from your last return.</p></div>
        <label className="flex items-center gap-2 self-center"><input type="checkbox" checked={professional} onChange={e => setProfessional(e.target.checked)} />
          The business provides professional services (never counts as a small company)</label>
        <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>Save</Button></div>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
        <Label htmlFor="year-end">Your accounts end in</Label>
        <select id="year-end" className="h-9 rounded-md border bg-background px-2" value={view.period.year_end_month} disabled={busy}
          onChange={e => { const month = Number(e.target.value); setBusy(true); setError('');
            void saveYearEndAction(month).then(r => { setBusy(false); if (r.success) setReload(n => n + 1); else setError(r.error); }); }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <span className="text-muted-foreground">Each tax year is the 12 months to the end of that month.</span>
      </div>
    </CardContent></Card>}

    <p className="text-xs text-muted-foreground">{view.note}</p>
  </div>;
}
