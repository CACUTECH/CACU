import { MembershipService } from '@/services/membership-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default async function UsersPage() {
  let result: Awaited<ReturnType<MembershipService['listActiveBusinessMembers']>>;
  try { result = await new MembershipService().listActiveBusinessMembers(); }
  catch { return <div className="space-y-4"><h1 className="text-3xl font-bold">Business members</h1>
    <p role="alert">Business members could not be loaded. Select a business and check that you have owner or administrator access, then refresh to retry.</p></div>; }
  return <div className="space-y-6"><h1 className="font-headline text-3xl font-bold">Business members</h1>
    <Card><CardHeader><CardTitle>Current memberships</CardTitle>
      <CardDescription>Invitations and permission changes are not available yet. These are saved memberships for your selected business.</CardDescription>
    </CardHeader><CardContent>
      {result.members.length === 0 ? <p>No members were returned.</p> : <Table>
        <TableHeader><TableRow><TableHead>Member ID</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
        <TableBody>{result.members.map(member => <TableRow key={member.user_id}>
          <TableCell className="break-all font-mono text-xs">{member.user_id}</TableCell>
          <TableCell className="capitalize">{member.role}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      <p className="mt-4 text-sm text-muted-foreground">Showing {result.members.length} of {result.total} memberships.</p>
    </CardContent></Card>
  </div>;
}
