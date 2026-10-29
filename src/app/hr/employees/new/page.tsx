import Link from 'next/link';
import { EmployeeForm } from '@/components/hr/employee-form';

export default function NewEmployeePage() {
  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/hr/employees" className="text-sm underline">Back to employees</Link>
    <h1 className="font-headline text-3xl font-bold">Add employee</h1>
    <EmployeeForm />
  </div>;
}
