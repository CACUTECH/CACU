"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNgn, cashFlowRows } from '@/lib/cash-flow';
import { downloadJson, type CloseInput, type CloseMetadata, type CloseReport, type NoteInput } from '@/lib/ifrs';
import { approveCloseAction, loadCloseAction, loadCloseMetadataAction, submitCloseAction } from './actions';

export default function CloseWorkspace() {
  const [metadata, setMetadata] = useState<CloseMetadata | null>(null);
  const [notes, setNotes] = useState<Record<string,NoteInput>>({});
  const [report, setReport] = useState<CloseReport | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [support, setSupport] = useState<{ schedules: unknown[]; maturities: unknown[]; equity_classifications: unknown[] }>({ schedules: [], maturities: [], equity_classifications: [] });
  const [approval, setApproval] = useState('');
  const pending = useRef<CloseInput | null>(null);
  useEffect(() => { let active = true; void loadCloseMetadataAction().then(result => {
    if (!active) return;
    if (result.success) { setMetadata(result.data); setNotes(Object.fromEntries(Object.keys(result.data.checklist).map(key => [key,{ applicable: false, assessment: '', evidence: '' }]))); }
    else setError(result.error);
  }); return () => { active = false; }; }, []);
  function updateNote(key: string, change: Partial<NoteInput>) { setNotes(current => ({ ...current, [key]: { ...current[key], ...change } })); }
  async function submit(form: FormData) {
    const input: CloseInput = { request_key: crypto.randomUUID(), start_date: String(form.get('start')), end_date: String(form.get('end')), annual: form.get('annual') === 'on', compare: form.get('compare') === 'prior' ? 'prior' : 'last_year', framework: 'full_ifrs', early_ifrs18: form.get('early') === 'on', accountant_name: String(form.get('accountant')), accountant_review_evidence: String(form.get('review')), notes, ...support };
    if (!pending.current) pending.current = input;
    setBusy(true); setError('');
    try {
      const result = await submitCloseAction(pending.current);
      if (!result.success) { setUncertain(result.uncertain); if (!result.uncertain) pending.current = null; throw new Error(result.error); }
      pending.current = null; setUncertain(false); setReport(result.data);
      const refreshed = await loadCloseMetadataAction(); if (refreshed.success) setMetadata(refreshed.data);
    } catch (e) { if (pending.current) setUncertain(true); setError(e instanceof Error ? e.message : 'Close not confirmed'); } finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError(''); setReport(null);
    try { const result = await loadCloseAction(id); if (!result.success) throw new Error(result.error); setReport(result.data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Close unavailable'); } finally { setBusy(false); }
  }
  async function approve() {
    if (!report) return; setBusy(true); setError('');
    try { const result = await approveCloseAction(report.id, approval); if (!result.success) throw new Error(result.error); setReport(result.data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Approval not confirmed'); } finally { setBusy(false); }
  }
  async function importSupport(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Use a supporting file smaller than 100 KB');
      const input: unknown = JSON.parse(await file.text());
      if (!input || typeof input !== 'object') throw new Error('Invalid supporting file');
      const value = input as Record<string,unknown>;
      if (!Array.isArray(value.schedules) || !Array.isArray(value.maturities) || !Array.isArray(value.equity_classifications)) throw new Error('The file must contain schedules, maturities and equity classifications');
      setSupport({ schedules: value.schedules, maturities: value.maturities, equity_classifications: value.equity_classifications }); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'File could not be read'); }
  }
  async function exportPdf() {
    if (!report) return;
    const { jsPDF } = await import('jspdf'); const { default: table } = await import('jspdf-autotable');
    const doc = new jsPDF(); doc.text('CACU financial close - NGN', 14, 15);
    const rows: string[][] = [['Status', report.review_status || 'Review required'], ['Basis', report.statement_basis], ['Qualification','Management statements; no automatic IFRS certification']];
    for (const [title,sections] of [['Profit or loss',report.statements.income_statement.sections],['Financial position',report.statements.financial_position.sections]] as const) {
      rows.push([title,'Current / comparative']); for (const section of sections) { for (const line of section.lines) rows.push([line.name,line.amounts.join(' / ')]); rows.push([section.title,section.total.join(' / ')]); }
    }
    rows.push(...cashFlowRows(report.cash_flow));
    if (report.comparative_cash_flow) rows.push(['Comparative cash flow',''],...cashFlowRows(report.comparative_cash_flow));
    else rows.push(['Comparative cash flow','Review required: ledger coverage is incomplete']);
    rows.push(['Other comprehensive income',report.comprehensive_income.other_comprehensive_income.join(' / ')],['Total comprehensive income',report.comprehensive_income.total_comprehensive_income.join(' / ')]);
    for (const equity of report.changes_in_equity) rows.push(['Equity period',equity.period.start_date+' to '+equity.period.end_date],['Opening equity',equity.opening_equity],['Profit',equity.profit],...Object.entries(equity.movements),['Closing equity',equity.closing_equity],['Equity difference',equity.difference]);
    for (const [key,note] of Object.entries(report.notes)) rows.push([key,`${note.applicable ? 'Applicable' : 'Not applicable'}: ${note.assessment} Evidence: ${note.evidence}`]);
    for (const issue of report.issues) rows.push(['Review issue: '+issue.check,issue.message]);
    table(doc,{ startY:22,head:[['Description','Amounts / review evidence']],body:rows }); doc.save('CACU-financial-close.pdf');
  }
  return <main className="mx-auto max-w-5xl space-y-6">
    <header><Link href="/reports" className="underline">Reports</Link><h1 className="text-3xl font-bold">Accounting policies & financial close</h1><p className="text-muted-foreground">Prepare statements, notes and reconciled supporting schedules for independent review. Approval records a review; it does not automatically certify IFRS compliance.</p></header>
    <Link href="/inventory/valuation" className="text-primary underline">Inventory valuation and cash classification</Link>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {uncertain && <p role="status">Submission was not confirmed. Retry sends the same saved submission and request key.</p>}
    {metadata && <>
      <form onSubmit={event => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className="space-y-5 rounded-xl border p-5">
        <fieldset disabled={busy || uncertain} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2"><label>Period start<Input name="start" type="date" required /></label><label>Period end<Input name="end" type="date" required /></label></div>
          <label className="flex gap-2"><input name="annual" type="checkbox" defaultChecked />Annual package with corresponding prior-year comparison</label>
          <label className="block">Comparison (annual statements require the corresponding prior year)<select name="compare" className="block w-full rounded border bg-background p-2" defaultValue="last_year"><option value="last_year">Same period last year</option><option value="prior">Immediately preceding period</option></select></label>
          <label className="flex gap-2"><input name="early" type="checkbox" />Early IFRS 18 adoption (requires a separately reviewed transition package)</label>
          <label className="block">Reviewing accountant<Input name="accountant" minLength={3} maxLength={200} required /></label>
          <label className="block">Accountant review reference<Input name="review" minLength={10} maxLength={2000} required /></label>
          <div className="space-y-3">{Object.entries(metadata.checklist).map(([key,title]) => <details key={key} className="rounded-lg border p-3"><summary>{key}: {title}</summary><div className="space-y-3 pt-3">
            <label className="flex gap-2"><input type="checkbox" checked={notes[key]?.applicable || false} onChange={e => updateNote(key,{ applicable:e.target.checked })} />Applicable to this business and period</label>
            <label className="block">Policy, disclosure and assessment (explain exclusions)<textarea className="block w-full rounded border bg-background p-2" minLength={10} maxLength={4000} required value={notes[key]?.assessment || ''} onChange={e => updateNote(key,{ assessment:e.target.value })} /></label>
            <label className="block">Supporting review reference<Input minLength={10} maxLength={2000} required value={notes[key]?.evidence || ''} onChange={e => updateNote(key,{ evidence:e.target.value })} /></label>
          </div></details>)}</div>
          <p>Supporting schedules use signed debit balances and separate positive debit/credit movements. Import the accountant-prepared file; every account and ledger tie is checked.</p>
          <Button type="button" variant="outline" onClick={() => downloadJson('CACU-close-account-reference.json',{ accounts:metadata.accounts, schedules:[],maturities:[],equity_classifications:[] })}>Download business account reference</Button>
          <a href="/templates/ifrs-close-support.json" download className="underline">Download supporting schedule template</a>
          <label className="block">Import supporting schedules<Input type="file" accept=".json,application/json" onChange={e => void importSupport(e.target.files?.[0])} /></label>
          <p>{support.schedules.length} schedules, {support.maturities.length} maturity reviews, {support.equity_classifications.length} equity classifications loaded.</p>
        </fieldset>
        <Button disabled={busy} type="submit">{busy ? 'Checking…' : uncertain ? 'Retry saved submission' : 'Save and check close'}</Button>
      </form>
      <section className="space-y-2"><h2 className="text-xl font-semibold">Saved close versions</h2>{metadata.closes.length === 0 && <p>No submissions yet.</p>}{metadata.closes.map(close => <Button key={close.id} variant="outline" disabled={busy} onClick={() => void open(close.id)}>{close.start_date} to {close.end_date} · {close.created_at}</Button>)}</section>
    </>}
    {report && <section className="space-y-4 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">{report.review_status === 'approved' ? 'Review recorded' : 'Review required'}</h2>
      <p>{report.statement_basis} · Current and prior-year amounts</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => downloadJson('CACU-financial-close.json',report)}>Download complete review package</Button><Button variant="outline" onClick={() => void exportPdf()}>Export statements and notes PDF</Button></div>
      {report.issues.length > 0 && <ul className="list-disc pl-5">{report.issues.map((issue,i) => <li key={i}>{issue.check}: {issue.message}</li>)}</ul>}
      <h3 className="font-semibold">Comprehensive income</h3><p>Net profit: {report.comprehensive_income.net_profit.map(formatNgn).join(' / ')} · OCI: {report.comprehensive_income.other_comprehensive_income.map(formatNgn).join(' / ')} · Total: {report.comprehensive_income.total_comprehensive_income.map(formatNgn).join(' / ')}</p>
      <h3 className="font-semibold">Changes in equity</h3>{report.changes_in_equity.map((equity,i) => <div key={i}><p>{equity.period.start_date} to {equity.period.end_date}</p><p>Opening {formatNgn(equity.opening_equity)} + profit {formatNgn(equity.profit)} + classified movements = closing {formatNgn(equity.closing_equity)}. Difference: {formatNgn(equity.difference)}</p></div>)}
      <label className="block">Independent Owner/Admin approval reference<Input minLength={10} value={approval} onChange={e => setApproval(e.target.value)} /></label><Button disabled={busy || !report.ready_for_owner_approval || approval.trim().length < 10} onClick={() => void approve()}>Record independent approval</Button>
    </section>}
  </main>;
}
