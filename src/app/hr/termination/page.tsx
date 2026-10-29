import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Page() {
  return <div className="mx-auto w-full max-w-2xl space-y-6">
    <h1 className="font-headline text-3xl font-bold">Employee Departure</h1>
    <Card><CardHeader><CardTitle>Record departures on the employee record</CardTitle>
      <CardDescription>Open the employee and use Record departure to set the last working day and reason. The record and its history are kept, and the employee can be rehired. AI departure letters are not available yet.</CardDescription></CardHeader>
      <CardContent><Button asChild variant="outline"><Link href="/hr/employees">Go to employees</Link></Button></CardContent>
    </Card>
  </div>;
}
