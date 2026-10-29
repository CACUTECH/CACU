import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const SECTIONS = [
  { title: 'Employees', href: '/hr/employees', action: 'View employees', text: 'Add staff, keep job and pay details current, change status and record departures. Every change is kept in the record history.' },
  { title: 'Attendance', href: '/hr/attendance', action: 'Open attendance', text: 'Check active employees in and out. Each employee can have only one open shift at a time.' },
  { title: 'Payroll', href: '/hr/payroll', action: 'Open payroll', text: 'Build monthly drafts with PAYE, pension and NHF, then approve them. Approved payroll cannot be changed.' },
];

export default function HRPage() {
  return <div className="space-y-6">
    <h1 className="font-headline text-3xl font-bold">HR &amp; workforce</h1>
    <div className="grid gap-4 md:grid-cols-3">
      {SECTIONS.map(s => <Card key={s.href}><CardHeader><CardTitle>{s.title}</CardTitle><CardDescription>{s.text}</CardDescription></CardHeader>
        <CardContent><Button asChild variant="outline"><Link href={s.href}>{s.action}</Link></Button></CardContent></Card>)}
    </div>
    <p className="text-sm text-muted-foreground">HR is restricted to Owners and Admins. Payroll is not posted to accounting or paid out from here. AI employment letters are not available.</p>
  </div>;
}
