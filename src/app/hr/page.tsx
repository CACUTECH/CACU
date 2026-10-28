import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function HRPage() {
  return <div className="space-y-6">
    <h1 className="font-headline text-3xl font-bold">HR &amp; workforce</h1>
    <Card><CardHeader><CardTitle>Employee directory</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p>View personnel records for your active business. Access is restricted to Owners and Admins.</p>
        <Button asChild><Link href="/hr/employees">View employees</Link></Button>
      </CardContent>
    </Card>
    <p className="text-sm text-muted-foreground">Employee changes, attendance, payroll and employment documents need further workflow verification before activation.</p>
  </div>;
}
