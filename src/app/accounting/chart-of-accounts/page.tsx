"use client";

import * as React from 'react';
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/components/business-provider';
import type { ChartAccount, ChartOfAccounts } from '@/services/chart-service';
import { adoptDefaultChartAction, getChartOfAccountsAction } from './actions';

/** FR-131 read view of the business's chart (Doc 09 section 4, Doc 12 SCR-19). Accounts change through reviewed setup only. */
const GROUPS: { type: ChartAccount['account_type']; title: string; term: string }[] = [
  { type: 'asset', title: 'What the business owns', term: 'Assets' },
  { type: 'liability', title: 'What the business owes', term: 'Liabilities' },
  { type: 'equity', title: "Owner's money", term: 'Equity' },
  { type: 'revenue', title: 'Money coming in', term: 'Income' },
  { type: 'expense', title: 'Money going out', term: 'Expenses' },
];
const USED_FOR: Record<string, string> = {
  cash: 'Cash sales and cash payments', bank: 'Transfers and bank payments', transfer_clearing: 'Transfers waiting for you to confirm',
  receivables: 'What customers owe you', inventory: 'Value of stock on hand', prepayments: 'Bills paid in advance',
  payables: 'What you owe suppliers', accruals: 'Bills received but not yet paid', capital: 'Money you put into the business',
  drawings: 'Money or goods you took out', retained_earnings: 'Profit kept in the business',
  equity: 'Balances you enter when you start your books', revenue: 'Sales', service_revenue: 'Sales of services',
  cogs: 'Cost of the stock you sold', stock_adjustment: 'Stock losses and corrections', gateway_fees: 'Bank and card charges',
  cash_variance: 'Till shortages and surpluses',
};

export default function ChartOfAccountsPage() {
  const { business } = useBusiness();
  const canSetUp = business?.userRole === 'owner' || business?.userRole === 'admin';
  const [chart, setChart] = React.useState<ChartOfAccounts | null>(null);
  const [error, setError] = React.useState('');
  const [adoptError, setAdoptError] = React.useState('');
  const [adopting, setAdopting] = React.useState(false);
  // Kept until the accounts are confirmed, so a retry cannot add them twice.
  const requestKey = React.useRef('');

  const load = React.useCallback(async () => {
    setError('');
    setChart(null);
    const result = await getChartOfAccountsAction();
    if (result.success) setChart(result.data);
    else setError(result.error);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const adopt = async () => {
    setAdopting(true);
    setAdoptError('');
    requestKey.current ||= crypto.randomUUID();
    const result = await adoptDefaultChartAction(requestKey.current);
    setAdopting(false);
    if (!result.success) { setAdoptError(result.error); return; }
    requestKey.current = '';
    await load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-headline text-3xl font-bold tracking-tight">Chart of Accounts</h1>
        <p className="text-muted-foreground">The accounts your books use. Sales, payments and stock post to them automatically.</p>
      </div>

      {error ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p role="alert" className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
        </div>
      ) : !chart ? (
        <div role="status" className="flex items-center justify-center gap-3 rounded-xl border bg-muted/20 py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />Loading accounts
        </div>
      ) : chart.accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No accounts yet</CardTitle>
            <CardDescription>
              CACU has a standard set of accounts for Nigerian small businesses, matched to how you sell. You can review them before you start your books.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canSetUp ? (
              <Button onClick={() => void adopt()} disabled={adopting} className="w-full sm:w-auto">
                {adopting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set up standard accounts
              </Button>
            ) : <p className="text-sm text-muted-foreground">Ask an Owner or Admin to set up the accounts.</p>}
            {adoptError && <p role="alert" className="text-sm text-destructive">{adoptError}</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <ReviewNotice chart={chart} />
          {GROUPS.map(group => {
            const accounts = chart.accounts.filter(account => account.account_type === group.type);
            if (!accounts.length) return null;
            return (
              <Card key={group.type}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{group.title}</CardTitle>
                  <CardDescription>{group.term}</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead className="w-16">Code</TableHead><TableHead>Account</TableHead><TableHead className="hidden sm:table-cell">Used for</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map(account => (
                        <TableRow key={account.id}>
                          <TableCell className="font-mono text-xs">{account.code}</TableCell>
                          <TableCell>
                            {account.name}{!account.is_active && <span className="ml-2 text-xs text-muted-foreground">(archived)</span>}
                            <span className="block text-xs text-muted-foreground sm:hidden">{account.purpose ? USED_FOR[account.purpose] : ''}</span>
                          </TableCell>
                          <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{account.purpose ? USED_FOR[account.purpose] : ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function ReviewNotice({ chart }: { chart: ChartOfAccounts }) {
  if (chart.books_active) {
    return <p className="flex items-center gap-2 rounded-xl border p-4 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-600" />Your books are live. These accounts receive your postings.</p>;
  }
  if (!chart.template) return null;
  if (chart.template.status === 'reviewed') {
    return (
      <p className="flex items-center gap-2 rounded-xl border p-4 text-sm">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        Standard accounts {chart.template.version}, reviewed by {chart.template.reviewed_by}. Your books are not started yet.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <span>Standard accounts {chart.template.version} are waiting for review by CACU&apos;s accountant. Nothing is posted to them until that review is done and you start your books.</span>
    </p>
  );
}
