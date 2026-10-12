import { getCollectionAccountsAction } from '@/app/accounting/collection-actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
export const dynamic = 'force-dynamic';

export default async function BankAccountsPage() {
  const choices = await getCollectionAccountsAction().catch(() => null);
  return <div className="space-y-6">
    <div><h1 className="font-headline text-3xl font-bold">Receiving bank accounts</h1>
      <p className="text-muted-foreground">Accounts available for recording manual Transfer payments.</p></div>
    <Card><CardHeader><CardTitle>Available accounts</CardTitle>
      <CardDescription>Live bank feeds and automatic balance synchronization are not connected.</CardDescription></CardHeader>
      <CardContent>{!choices ? <p role="alert">Bank accounts unavailable. Refresh your session and retry.</p>
        : !choices.native ? <p>Bank account selection requires reconciled accounting setup for this business.</p>
        : choices.accounts.length === 0 ? <p>No receiving bank accounts are available. Ask your accounting administrator to set up and review an account.</p>
        : <ul className="space-y-3">{choices.accounts.map(account => <li key={account.id} className="rounded-md border p-3 font-medium">{account.name}</li>)}</ul>}</CardContent>
    </Card>
  </div>;
}
