import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { PayrollRunActions } from '@/components/hr/payroll-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { naira, periodLabel } from '@/lib/hr';

const COLUMNS = [['gross', 'Gross'], ['pension_employee', 'Pension'], ['nhf', 'NHF'], ['nhis', 'NHIS'], ['paye', 'PAYE'], ['net', 'Net pay'], ['pension_employer', 'Employer pension']] as const;

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try { detail = await new HRService().payrollRun(id); }
  catch { return <div role="alert">Payroll run could not be loaded. <Link href={`/hr/payroll/${id}`}>Retry</Link></div>; }
  if (!detail) return <div role="alert">Payroll run not found in this business. <Link href="/hr/payroll">Return to payroll</Link></div>;
  const { run, payslips } = detail;
  const excluded = (Array.isArray(run.excluded) ? run.excluded : []) as { id: string; name: string; reason: string }[];
  const totals = Object.fromEntries(COLUMNS.map(([key]) => [key, payslips.reduce((sum, s) => sum + Number(s[key]), 0)]));
  return <div className="space-y-6">
    <Link href="/hr/payroll" className="text-sm underline">Back to payroll</Link>
    <h1 className="flex flex-wrap items-center gap-3 font-headline text-3xl font-bold">{periodLabel(run.period)} payroll
      <Badge variant={run.status === 'approved' ? 'default' : 'outline'} className="capitalize">{run.status}</Badge></h1>
    <p className="text-sm text-muted-foreground">
      Created {new Date(run.created_at).toLocaleString('en-NG')}{run.approved_at && ` · approved ${new Date(run.approved_at).toLocaleString('en-NG')}`}
      {run.cancelled_at && ` · cancelled ${new Date(run.cancelled_at).toLocaleString('en-NG')}`}. Rules: {run.rules?.source || 'custom'}{run.rules_reviewed_at ? ', reviewed' : ', unreviewed defaults'}.
    </p>
    {run.status === 'draft' && <Card><CardHeader><CardTitle>Review and approve</CardTitle></CardHeader><CardContent>
      <p className="mb-3 text-sm">Approval locks this payroll as the record for the month. It does not pay employees or post to accounting.</p>
      <PayrollRunActions id={run.id} version={run.version} reviewed={!!run.rules_reviewed_at} /></CardContent></Card>}
    <div className="overflow-x-auto rounded-md border"><Table>
      <TableHeader><TableRow><TableHead>Employee</TableHead>{COLUMNS.map(([key, label]) => <TableHead key={key} className="text-right">{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{payslips.map(slip => <TableRow key={slip.id}>
        <TableCell><span className="font-medium">{slip.employee_name}</span><span className="block text-xs text-muted-foreground">{slip.job_title || '—'} · taxable {naira(slip.chargeable_annual)}/yr</span></TableCell>
        {COLUMNS.map(([key]) => <TableCell key={key} className="text-right tabular-nums">{naira(slip[key])}</TableCell>)}
      </TableRow>)}</TableBody>
      <TableFooter><TableRow><TableCell>Total ({payslips.length})</TableCell>{COLUMNS.map(([key]) => <TableCell key={key} className="text-right tabular-nums">{naira(totals[key])}</TableCell>)}</TableRow></TableFooter>
    </Table></div>
    {excluded.length > 0 && <Card><CardHeader><CardTitle>Not included</CardTitle></CardHeader><CardContent>
      <ul className="space-y-1 text-sm">{excluded.map(e => <li key={e.id}><Link className="underline" href={`/hr/employees/${e.id}`}>{e.name}</Link>: {e.reason}</li>)}</ul>
    </CardContent></Card>}
  </div>;
}
