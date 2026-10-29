import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { EmployeeForm } from '@/components/hr/employee-form';
import { EmployeeStatusPanel } from '@/components/hr/employee-status-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { lagosToday, type HistoryEntry } from '@/lib/hr';

const EVENTS: Record<string, string> = {
  'employee.save': 'Details saved', 'employee.status': 'Status changed', 'employee.depart': 'Departure recorded',
};
const FIELD_LABELS: Record<string, string> = {
  full_name: 'name', job_title: 'job title', employment_status: 'status', monthly_salary: 'monthly gross', pay_basic: 'basic pay',
  pay_housing: 'housing', pay_transport: 'transport', pay_other: 'other allowances', annual_rent: 'declared rent', nhis_monthly: 'NHIS',
  pension_enrolled: 'pension', nhf_enrolled: 'NHF', tax_id: 'tax ID', pension_pin: 'pension PIN', start_date: 'start date',
  end_date: 'last working day', departure_reason: 'departure reason', created_by: '', created_at: '', id: '', business_id: '',
};

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = new HRService();
  let employee, history: HistoryEntry[] = [];
  try {
    employee = await service.getEmployee(id);
    if (employee) history = await service.history(id);
  } catch {
    return <div role="alert">Employee record could not be loaded. <Link href={`/hr/employees/${id}`}>Retry</Link></div>;
  }
  if (!employee) return <div role="alert">Employee not found in this business. <Link href="/hr/employees">Return to the employee directory</Link></div>;
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/hr/employees" className="text-sm underline">Back to employees</Link>
    <h1 className="font-headline text-3xl font-bold">{employee.full_name}</h1>
    <EmployeeStatusPanel employee={employee} today={lagosToday()} />
    <EmployeeForm key={employee.version} employee={employee} />
    <Card><CardHeader><CardTitle>Change history</CardTitle></CardHeader><CardContent>
      {history.length ? <ul className="space-y-2 text-sm">{history.map((entry, i) => {
        const fields = (entry.fields || []).map(f => FIELD_LABELS[f] ?? f.replace(/_/g, ' ')).filter(Boolean);
        return <li key={i}><span className="font-medium">{EVENTS[entry.event] || entry.event}</span> by {entry.actor} · {new Date(entry.created_at).toLocaleString('en-NG')}
          {fields.length > 0 && <span className="block text-muted-foreground">Changed: {fields.join(', ')}</span>}</li>;
      })}</ul> : <p className="text-sm text-muted-foreground">No changes recorded since HR history began. Earlier edits were not tracked.</p>}
    </CardContent></Card>
  </div>;
}
