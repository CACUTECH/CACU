"use client";
// Bank Reconciliation (Doc 03 FR-134; Doc 09 month-end step 2; E14 R3). Import a bank statement CSV, pointing out its
// columns once; match each line to what is recorded, confirm transfers the statement shows arrived, record bank charges
// and other income on the spot, or explain a line. The month is reconciled when every line and entry is accounted for.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explainLineAction, importStatementAction, matchLineAction, previewStatementAction, reconciliationAction, recordLineAction, undoLineAction } from './actions';
import { complete, money, type Layout, type Preview, type Reconciliation, type StatementLine } from '@/lib/bank-reconciliation';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const FIELDS: { key: keyof Layout; label: string; optional?: boolean }[] = [
  { key: 'date', label: 'Date' }, { key: 'description', label: 'Description' }, { key: 'money_in', label: 'Money in (credit)', optional: true },
  { key: 'money_out', label: 'Money out (debit)', optional: true }, { key: 'amount', label: 'Or one amount column', optional: true }, { key: 'balance', label: 'Balance', optional: true }];

function Importer({ accountId, onDone }: { accountId: string; onDone: (text: string) => void }) {
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [layout, setLayout] = React.useState<Partial<Layout>>({ date_order: 'DMY', header_row: 0 });
  const [key] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > 2_000_000) { setError('The statement is larger than 2 MB. Export a shorter period.'); return; }
    const text = await picked.text();
    setBusy(true); setError('');
    const r = await previewStatementAction(accountId, text);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setFile({ name: picked.name, text }); setPreview(r.data); setLayout(r.data.layout ?? { date_order: 'DMY', header_row: 0 });
  };
  const upload = async () => {
    if (!file || !complete(layout)) { setError('Choose the date, description and amount columns.'); return; }
    setBusy(true); setError('');
    const r = await importStatementAction(key, accountId, file.name, file.text, layout);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    const d = r.data;
    onDone(`${d.lines} line${d.lines === 1 ? '' : 's'} imported.${d.already_imported ? ` ${d.already_imported} already imported were skipped.` : ''}${d.before_books ? ` ${d.before_books} from before your books started were left out.` : ''}`);
  };
  const header = preview ? preview.rows[layout.header_row ?? 0] ?? [] : [];
  const set = (field: keyof Layout, value: string) => setLayout(l => ({ ...l, [field]: value === '' ? null : Number(value) }));

  return <section aria-label="Import a statement" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Import a bank statement</h2>
    <p className="text-sm text-muted-foreground">Download the statement from your bank as a CSV file. CACU remembers its layout for next time.</p>
    <Input aria-label="Statement file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void choose(e.target.files?.[0])} />
    {preview && <>
      {preview.remembered ? <p className="text-sm">Using the layout from your last statement for this account. Check it below.</p>
        : preview.layout ? <p className="text-sm">CACU has guessed the columns. Check them below.</p> : <p className="text-sm">Point out the columns below.</p>}
      <div className="space-y-1"><Label htmlFor="header-row">Which row has the column names?</Label>
        <select id="header-row" className="rounded-md border bg-background p-1 text-sm" value={layout.header_row ?? 0} onChange={e => setLayout(l => ({ ...l, header_row: Number(e.target.value) }))}>
          {preview.rows.map((row, i) => <option key={i} value={i}>Row {i + 1}: {row.slice(0, 4).join(' | ').slice(0, 60)}</option>)}</select></div>
      <div className="grid gap-2 sm:grid-cols-3">{FIELDS.map(f => <label key={f.key} className="space-y-1 text-sm"><span>{f.label}</span>
        <select aria-label={`${f.label} column`} className="w-full rounded-md border bg-background p-1" value={layout[f.key] == null ? '' : String(layout[f.key])} onChange={e => set(f.key, e.target.value)}>
          {f.optional && <option value="">None</option>}{header.map((name, i) => <option key={i} value={i}>{name || `Column ${i + 1}`}</option>)}</select></label>)}
        <label className="space-y-1 text-sm"><span>Dates are written</span>
          <select aria-label="Date order" className="w-full rounded-md border bg-background p-1" value={layout.date_order} onChange={e => setLayout(l => ({ ...l, date_order: e.target.value as Layout['date_order'] }))}>
            <option value="DMY">Day, month, year (18/11/2026)</option><option value="MDY">Month, day, year (11/18/2026)</option><option value="YMD">Year, month, day (2026-11-18)</option></select></label>
      </div>
      <Button type="button" disabled={busy || !complete(layout)} onClick={() => void upload()}>{busy ? 'Importing…' : `Import ${file?.name ?? ''}`}</Button>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}

function Line({ line, act }: { line: StatementLine; act: (work: () => Promise<{ success: boolean; error?: string }>, done: string) => Promise<void> }) {
  const [note, setNote] = React.useState(''), [explaining, setExplaining] = React.useState(false);
  const [key] = React.useState(() => crypto.randomUUID());
  const out = Number(line.amount) < 0;
  return <li className="space-y-2 py-3">
    <div className="flex flex-wrap justify-between gap-2"><span>{line.date} · {line.description}</span>
      <span className={out ? 'font-medium' : 'font-medium text-emerald-700'}>{money(line.amount)}</span></div>
    {line.status === 'matched' ? <p className="text-sm text-emerald-700">Matched{line.matched_to ? ` to ${line.matched_to}` : ''} · <button className="underline" onClick={() => void act(() => undoLineAction(line.id), 'Line put back.')}>Undo</button></p>
      : line.status === 'explained' ? <p className="text-sm">Explained: {line.note} · <button className="underline" onClick={() => void act(() => undoLineAction(line.id), 'Line put back.')}>Undo</button></p>
      : <div className="flex flex-wrap gap-2">
        {line.suggestions.map((s, i) => <Button key={i} type="button" size="sm" onClick={() => void act(() => matchLineAction(line.id, s.kind === 'entry' ? { transaction_id: s.transaction_id } : { transfer_id: s.transfer_id }),
          s.kind === 'entry' ? 'Matched.' : 'Transfer confirmed and matched.')}>{s.kind === 'entry' ? `Match ${s.number ?? ''} (${s.date})` : `Confirm transfer of ${s.date} and match`}</Button>)}
        <Button type="button" size="sm" variant="outline" onClick={() => void act(() => recordLineAction(line.id, key, out ? 'expense' : 'income'), out ? 'Recorded as a bank charge and matched.' : 'Recorded as other income and matched.')}>
          {out ? 'Record as bank charge' : 'Record as other income'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExplaining(e => !e)}>Explain</Button>
        {explaining && <span className="flex w-full gap-2"><Input aria-label={`Why ${line.description} needs no entry`} value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
          <Button type="button" size="sm" disabled={note.trim().length < 5} onClick={() => void act(() => explainLineAction(line.id, note.trim()), 'Explained.')}>Save</Button></span>}
      </div>}
  </li>;
}

export default function ReconciliationPage() {
  const [account, setAccount] = React.useState<string | null>(null), [month, setMonth] = React.useState(thisMonth);
  const [view, setView] = React.useState<Reconciliation | null>(null), [importing, setImporting] = React.useState(false);
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await reconciliationAction(account, month);
    setLoading(false);
    if (r.success) { setView(r.data); setError(''); if (!account && r.data.account) setAccount(r.data.account); } else { setView(null); setError(r.error); }
  }, [account, month]);
  React.useEffect(() => { void load(); }, [load]);

  const act = async (work: () => Promise<{ success: boolean; error?: string }>, done: string) => {
    setError(''); setMessage('');
    const r = await work();
    if (!r.success) { setError(r.error ?? 'That did not work. Try again.'); return; }
    setMessage(done); await load();
  };

  return <div className="max-w-4xl space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Bank Reconciliation</h1>
      <p className="text-muted-foreground">Check your bank statement against your books, line by line.</p></div>
    {loading && !view ? <p role="status">Loading…</p> : view && view.accounts.length === 0 ? <p>Add a bank account to your chart first, then come back with its statement.</p> : view && <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1"><Label htmlFor="rec-account">Bank account</Label>
          <select id="rec-account" className="rounded-md border bg-background p-2" value={view.account ?? ''} onChange={e => setAccount(e.target.value)}>
            {view.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="rec-month">Month</Label><Input id="rec-month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
        <Button type="button" variant="outline" onClick={() => setImporting(i => !i)}>{importing ? 'Close import' : 'Import a statement'}</Button>
      </div>
      {importing && view.account && <Importer accountId={view.account} onDone={text => { setImporting(false); setMessage(text); void load(); }} />}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
      {view.summary && <p className={`rounded-lg p-3 text-sm ${view.summary.reconciled ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
        {view.summary.reconciled ? 'Reconciled: every statement line and every bank entry for the month is accounted for.'
          : view.summary.lines === 0 ? 'No statement lines for this month yet. Import the statement.'
          : `${view.summary.unmatched} statement line${view.summary.unmatched === 1 ? '' : 's'} to match, and ${view.summary.unpresented} entr${view.summary.unpresented === 1 ? 'y' : 'ies'} in your books not on the statement.`}
        {' '}Books: {money(view.books_balance ?? '0')}{view.statement_balance ? ` · statement: ${money(view.statement_balance)}` : ''}</p>}
      {view.lines && view.lines.length > 0 && <section aria-label="Statement lines" className="rounded-xl border px-4">
        <ul className="divide-y text-sm">{view.lines.map(l => <Line key={l.id} line={l} act={act} />)}</ul></section>}
      {view.unpresented && view.unpresented.length > 0 && <section aria-label="Not on the statement" className="space-y-1 rounded-xl border p-4 text-sm">
        <h2 className="font-semibold">In your books, not on the statement</h2>
        <p className="text-muted-foreground">Usually payments made near the month end that the bank shows next month, or entries made against the wrong account.</p>
        <ul>{view.unpresented.map(u => <li key={u.transaction_id}>{u.date} · {u.number} · {u.description} · {money(u.amount)}</li>)}</ul></section>}
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
