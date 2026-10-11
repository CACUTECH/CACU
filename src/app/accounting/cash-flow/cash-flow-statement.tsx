"use client";
import { useRef, useState } from 'react';
import { subDays, differenceInCalendarDays, format } from 'date-fns';
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
  const [compare, setCompare] = useState(false);
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
        const first = new Date(`${start}T12:00:00`);
        const count = differenceInCalendarDays(new Date(`${end}T12:00:00`), first) + 1;
        const result = await getCashFlowAction(format(subDays(first, count), 'yyyy-MM-dd'), format(subDays(first, 1), 'yyyy-MM-dd'));
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
      const document = new jsPDF(); document.text('CACU Statement of Cash Flows (NGN)', 14, 15);
      autoTable(document, { startY: 22, head: [['Description', 'Amount / scope']], body: rows });
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
    <p className="text-muted-foreground">Indirect method Â· NGN Â· Posted accounting ledger</p>
    <form className="flex flex-wrap items-end gap-4 rounded-xl border bg-muted/30 p-4" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>Start date<Input type="date" value={start} onChange={event => { requestVersion.current++; setLoading(false); setStart(event.target.value); setReport(null); setPrior(null); }} required /></label>
      <label>End date<Input type="date" value={end} onChange={event => { requestVersion.current++; setLoading(false); setEnd(event.target.value); setReport(null); setPrior(null); }} required /></label>
      <label className="flex gap-2 items-center pb-2"><input type="checkbox" checked={compare} onChange={event => { requestVersion.current++; setLoading(false); setCompare(event.target.checked); setReport(null); setPrior(null); }} />Compare previous equal period</label>
      <Button disabled={loading || !valid} type="submit">{loading ? 'Loadingâ€¦' : 'Run report'}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!report && !loading && !error && <p>Select a reporting period and run the report.</p>}
    {report && <>
      <p>{report.start_date} to {report.end_date} Â· Company timezone: {report.timezone}</p>
      {prior && <p>Comparison: {prior.start_date} to {prior.end_date}</p>}
      {report.empty && <p>No posted movements in this period. Opening balances are retained.</p>}
      {(!report.reconciled || (prior && !prior.reconciled)) && <p role="alert" className="text-destructive">Cash does not reconcile. Review the supporting transactions before using this report.</p>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => void exportFile('csv')}>CSV</Button><Button onClick={() => void exportFile('excel')}>Excel</Button><Button onClick={() => void exportFile('pdf')}>PDF</Button></div>
      {report.sections.map(section => <Card key={section.key}><CardHeader><CardTitle className="capitalize">{section.key} activities</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full min-w-[480px]"><thead><tr><th className="text-left">Description</th><th className="text-right">Current (NGN)</th>{prior && <th className="text-right">Prior (NGN)</th>}</tr></thead><tbody>
          {comparisonLines(section).map(line => <tr key={line.label}><td className="py-3"><details><summary className="cursor-pointer">{line.label}</summary><ul>{line.details.map((detail, index) => <li key={`${detail.ledger_id}-${index}`} className="text-sm py-1">{detail.date} Â· {detail.transaction_no} Â· {detail.account_name} Â· {detail.description} Â· {formatNgn(detail.amount)}</li>)}</ul></details></td><td className="text-right">{formatNgn(line.amount)}</td>{prior && <td className="text-right">{formatNgn(prior.sections.find(s => s.key === section.key)?.lines.find(l => l.label === line.label)?.amount || '0.00')}</td>}</tr>)}
          <tr className="border-t font-bold"><td>Total {section.key}</td><td className="text-right">{formatNgn(section.total)}</td>{prior && <td className="text-right">{formatNgn(prior.sections.find(s => s.key === section.key)?.total || '0.00')}</td>}</tr>
        </tbody></table></div>
      </CardContent></Card>)}
      <Card><CardHeader><CardTitle>Cash reconciliation</CardTitle></CardHeader><CardContent><table className="w-full"><tbody>
        {([['Opening cash', 'opening_cash'], ['Net change', 'net_change'], ['FX effect', 'fx_effect'], ['Closing cash', 'closing_cash'], ['Ledger cash', 'ledger_cash'], ['Difference', 'difference']] as const).map(([label, key]) => <tr key={key}><th className="text-left py-2">{label}</th><td className="text-right">{formatNgn(report[key])}</td>{prior && <td className="text-right">{formatNgn(prior[key])}</td>}</tr>)}
      </tbody></table><p>{report.reconciled ? 'Reconciled' : 'Review required'}</p></CardContent></Card>
    </>}
  </div>;
}
