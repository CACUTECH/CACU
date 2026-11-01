"use client";
import { useRef, useState } from 'react';
import { subDays, subYears, differenceInCalendarDays, format } from 'date-fns';
import { getCashFlowAction } from './actions';
import { cashFlowRows, formatNgn, reportCsv, type CashFlowReport } from '@/lib/cash-flow';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function CashFlowStatement({ embedded = false }: { embedded?: boolean }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const [start, setStart] = useState(`${today.slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [compare, setCompare] = useState<'' | 'prior' | 'last_year'>('');
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [prior, setPrior] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  async function load() {
    const version = ++requestVersion.current;
    setLoading(true); setError(''); setReport(null); setPrior(null);
    try {
      const current = await getCashFlowAction(start, end);
      if (!current.success) throw new Error(current.error);
      let previous: CashFlowReport | null = null;
      if (compare) {
        const first = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`);
        const count = differenceInCalendarDays(last, first) + 1;
        // Doc 09: the period before, or the same period last year.
        const [from, to] = compare === 'prior' ? [subDays(first, count), subDays(first, 1)] : [subYears(first, 1), subYears(last, 1)];
        const result = await getCashFlowAction(format(from, 'yyyy-MM-dd'), format(to, 'yyyy-MM-dd'));
        if (!result.success) throw new Error(`Comparison unavailable: ${result.error}`);
        previous = result.data;
      }
      if (version === requestVersion.current) { setReport(current.data); setPrior(previous); }
    } catch (failure) { if (version === requestVersion.current) setError(failure instanceof Error ? failure.message : 'Cash flow unavailable'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  async function exportFile(kind: 'csv' | 'excel' | 'pdf') {
    if (!report) return;
    const rows = cashFlowRows(report);
    if (prior) rows.push([], ['Prior period', `${prior.start_date} to ${prior.end_date}`], ...cashFlowRows(prior));
    if (kind === 'csv') {
      const content = reportCsv(report) + (prior ? `\r\n\r\n${reportCsv(prior)}` : '');
      const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `cash-flow-${report.start_date}-${report.end_date}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } else if (kind === 'excel') {
      const XLSX = await import('xlsx'); const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Cash Flow');
      XLSX.writeFile(book, `cash-flow-${report.start_date}-${report.end_date}.xlsx`);
    } else {
      const { jsPDF } = await import('jspdf'); const { default: autoTable } = await import('jspdf-autotable');
      const document = new jsPDF(); document.text('Statement of Cash Flows (NGN)', 14, 15);
      document.text('Management statements, not reviewed · Indirect method', 14, 22);
      autoTable(document, { startY: 29, head: [['Description', 'Amount / scope']], body: rows });
      document.save(`cash-flow-${report.start_date}-${report.end_date}.pdf`);
    }
  }
  function comparisonLines(section: CashFlowReport['sections'][number]) {
    const previous = prior?.sections.find(value => value.key === section.key)?.lines || [];
    return [...section.lines, ...previous.filter(line => !section.lines.some(current => current.label === line.label)).map(line => ({ ...line, amount: '0.00', details: [] }))];
  }
  const valid = !!start && !!end && start <= end;
  return <div className="space-y-6">
    {!embedded && <><Link href="/reports" className="text-primary underline">Reports</Link><h1 className="text-3xl font-bold">Statement of Cash Flows</h1></>}
    <p className="text-muted-foreground">Management statements, not reviewed · Indirect method · Accrual basis · NGN · Posted accounting ledger</p>
    <form className="flex flex-wrap items-end gap-4 rounded-xl border bg-muted/30 p-4" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>Start date<Input type="date" value={start} onChange={event => { requestVersion.current++; setLoading(false); setStart(event.target.value); setReport(null); setPrior(null); }} required /></label>
      <label>End date<Input type="date" value={end} onChange={event => { requestVersion.current++; setLoading(false); setEnd(event.target.value); setReport(null); setPrior(null); }} required /></label>
      <label>Compare with<select aria-label="Compare with" className="block rounded-md border bg-background p-2" value={compare} onChange={event => { requestVersion.current++; setLoading(false); setCompare(event.target.value as typeof compare); setReport(null); setPrior(null); }}>
        <option value="">No comparison</option><option value="prior">The period before</option><option value="last_year">Same period last year</option></select></label>
      <Button disabled={loading || !valid} type="submit">{loading ? 'Loading…' : 'Run report'}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!report && !loading && !error && <p>Select a reporting period and run the report.</p>}
    {report && <>
      <p>{report.start_date} to {report.end_date} · Company timezone: {report.timezone}</p>
      {prior && <p>Comparison: {prior.start_date} to {prior.end_date}</p>}
      {report.empty && <p>No posted movements in this period. Opening balances are retained.</p>}
      {(!report.reconciled || (prior && !prior.reconciled)) && <p role="alert" className="text-destructive">Cash does not reconcile. Review the supporting transactions before using this report.</p>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => void exportFile('csv')}>CSV</Button><Button onClick={() => void exportFile('excel')}>Excel</Button><Button onClick={() => void exportFile('pdf')}>PDF</Button></div>
      {report.sections.map(section => <Card key={section.key}><CardHeader><CardTitle className="capitalize">{section.key} activities</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full min-w-[480px]"><thead><tr><th className="text-left">Description</th><th className="text-right">Current (NGN)</th>{prior && <th className="text-right">Prior (NGN)</th>}</tr></thead><tbody>
          {comparisonLines(section).map(line => <tr key={line.label}><td className="py-3"><details><summary className="cursor-pointer">{line.label}</summary><ul>{line.details.map((detail, index) => <li key={`${detail.ledger_id}-${index}`} className="text-sm py-1">{detail.date} · {detail.transaction_no} · {detail.account_name} · {detail.description} · {formatNgn(detail.amount)}</li>)}</ul></details></td><td className="text-right">{formatNgn(line.amount)}</td>{prior && <td className="text-right">{formatNgn(prior.sections.find(s => s.key === section.key)?.lines.find(l => l.label === line.label)?.amount || '0.00')}</td>}</tr>)}
          <tr className="border-t font-bold"><td>Total {section.key}</td><td className="text-right">{formatNgn(section.total)}</td>{prior && <td className="text-right">{formatNgn(prior.sections.find(s => s.key === section.key)?.total || '0.00')}</td>}</tr>
        </tbody></table></div>
      </CardContent></Card>)}
      {report.cash_components && <Card><CardHeader><CardTitle>Cash components and restrictions</CardTitle></CardHeader><CardContent><p>{report.policy_basis}</p><p>Confirm cash-equivalent eligibility, restrictions and any balance-sheet presentation differences in the financial-close notes.</p><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Account</th><th>Opening (NGN)</th><th>Closing (NGN)</th><th>Restricted</th></tr></thead><tbody>{report.cash_components.map(line => <tr key={line.account_id}><td>{line.name}</td><td>{formatNgn(line.opening)}</td><td>{formatNgn(line.closing)}</td><td>{line.restricted ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div></CardContent></Card>}
      {report.financing_reconciliation && <Card><CardHeader><CardTitle>Financing-liability reconciliation</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Liability</th><th>Opening</th><th>Cash changes</th><th>Non-cash changes</th><th>Closing</th></tr></thead><tbody>{report.financing_reconciliation.map(line => <tr key={line.account_id}><td>{line.name}</td><td>{formatNgn(line.opening)}</td><td>{formatNgn(line.cash_movements)}</td><td>{formatNgn(line.noncash_movements)}</td><td>{formatNgn(line.closing)}</td></tr>)}</tbody></table></div><Link href="/accounting/policies" className="underline">Review financing terms, supplier-finance arrangements and complete notes</Link></CardContent></Card>}
      <Card><CardHeader><CardTitle>Cash reconciliation</CardTitle></CardHeader><CardContent><table className="w-full"><tbody>
        {([['Opening cash', 'opening_cash'], ['Net change', 'net_change'], ['FX effect', 'fx_effect'], ['Closing cash', 'closing_cash'], ['Ledger cash', 'ledger_cash'], ['Difference', 'difference']] as const).map(([label, key]) => <tr key={key}><th className="text-left py-2">{label}</th><td className="text-right">{formatNgn(report[key])}</td>{prior && <td className="text-right">{formatNgn(prior[key])}</td>}</tr>)}
      </tbody></table><p>{report.reconciled ? 'Reconciled' : 'Review required'}</p></CardContent></Card>
    </>}
  </div>;
}
