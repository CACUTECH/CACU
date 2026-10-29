import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default async function EmployeesPage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { page: requested } = await searchParams;
  const page = requested === undefined ? 0 : typeof requested === 'string' && /^\d{1,6}$/.test(requested) ? Number(requested) : NaN;
  if (!Number.isSafeInteger(page) || page > 100000) {
    return <div role="alert">Invalid employee page. <Link href="/hr/employees">Return to the employee directory</Link></div>;
  }
  let records;
  try { records = await new HRService().listEmployeeDirectory(page); }
  catch {
    return <div role="alert">Employee records could not be loaded. <Link href={`/hr/employees?page=${page}`}>Retry</Link></div>;
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-headline text-3xl font-bold">Employee directory</h1>
      <Button asChild><Link href="/hr/employees/new">Add employee</Link></Button>
    </div>
    <p className="text-muted-foreground">Personnel records for your active business. Salary and bank details are excluded from this directory. Open an employee to see pay details and history.</p>
    <div className="overflow-x-auto rounded-md border">
      <Table><TableHeader><TableRow>
        <TableHead>Name</TableHead><TableHead>Job title</TableHead><TableHead>Department</TableHead><TableHead>Status</TableHead>
      </TableRow></TableHeader><TableBody>
        {records.data.map(employee => <TableRow key={employee.id}>
          <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/hr/employees/${employee.id}`}>{employee.full_name || 'Unnamed employee'}</Link></TableCell>
          <TableCell>{employee.job_title || '—'}</TableCell>
          <TableCell>{employee.department || '—'}</TableCell>
          <TableCell>{employee.employment_status || 'Unspecified'}</TableCell>
        </TableRow>)}
        {records.data.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center">
          {page === 0 ? 'No employees registered in this business.' : 'No employees on this page.'}
        </TableCell></TableRow>}
      </TableBody></Table>
    </div>
    <nav aria-label="Employee pages" className="flex items-center gap-4">
      {page > 0 && <Button asChild variant="outline"><Link href={`/hr/employees?page=${page - 1}`}>Previous</Link></Button>}
      <span>Page {page + 1} &middot; {records.total} employees</span>
      {page < 100000 && (page + 1) * 20 < records.total && <Button asChild variant="outline"><Link href={`/hr/employees?page=${page + 1}`}>Next</Link></Button>}
    </nav>
  </div>;
}
