import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { PayrollCreate } from '@/components/hr/payroll-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { lagosToday, naira, periodLabel } from '@/lib/hr';

export default async function PayrollPage() {
  const service = new HRService();
  let runs, rules;
  try { [runs, rules] = await Promise.all([service.payrollRuns(), service.payrollRules()]); }
  catch { return <div role="alert">Payroll could not be loaded. <Link href="/hr/payroll">Retry</Link></div>; }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-headline text-3xl font-bold">Payroll</h1>
      <Button asChild variant="outline"><Link href="/hr/payroll/rules">Payroll rules</Link></Button>
    </div>
    {!rules.reviewed_at && <p role="status" className="rounded-md border p-3 text-sm">Payroll uses the Nigeria Tax Act 2025 defaults, which nobody in this business has reviewed yet. You can create drafts, but approval requires <Link className="underline" href="/hr/payroll/rules">reviewed rules</Link>.</p>}
    <Card><CardHeader><CardTitle>New payroll run</CardTitle>
      <CardDescription>Uses each employee&apos;s current pay structure. Departed employees and those without basic pay are listed but not paid.</CardDescription></CardHeader>
      <CardContent><PayrollCreate currentMonth={lagosToday().slice(0, 7)} /></CardContent></Card>
    <div className="overflow-x-auto rounded-md border"><Table>
      <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead>Employees</TableHead><TableHead>Gross</TableHead><TableHead>PAYE</TableHead><TableHead>Net pay</TableHead></TableRow></TableHeader>
      <TableBody>
        {runs.map(run => <TableRow key={run.id}>
          <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/hr/payroll/${run.id}`}>{periodLabel(run.period)}</Link></TableCell>
          <TableCell><Badge variant={run.status === 'approved' ? 'default' : 'outline'} className="capitalize">{run.status}</Badge></TableCell>
          <TableCell>{run.employee_count}</TableCell><TableCell>{naira(run.gross_total)}</TableCell><TableCell>{naira(run.paye_total)}</TableCell><TableCell>{naira(run.net_total)}</TableCell>
        </TableRow>)}
        {!runs.length && <TableRow><TableCell colSpan={6} className="py-8 text-center">No payroll runs yet.</TableCell></TableRow>}
      </TableBody>
    </Table></div>
  </div>;
}
