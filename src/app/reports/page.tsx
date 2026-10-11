"use client";

import { useEffect, useState } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart3, Landmark, ArrowRightLeft, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { formatNgn } from '@/lib/cash-flow';
import { getProfitAndLossAction, getBalanceSheetAction } from './actions';

import CashFlowStatement from '@/app/accounting/cash-flow/cash-flow-statement';
type IncomeStatement = NonNullable<Awaited<ReturnType<typeof getProfitAndLossAction>>['data']>;
type BalanceSheet = NonNullable<Awaited<ReturnType<typeof getBalanceSheetAction>>['data']>;
function LoadingStatement() {
    return <div role="status" className="flex items-center justify-center gap-3 rounded-xl border bg-muted/20 py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" />Loading statementÃ¢â‚¬Â¦</div>;
}
function StatementError({ message, retry }: { message: string; retry: () => void }) {
    return <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6"><p role="alert" className="text-destructive">{message}</p><Button variant="outline" onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>;
}
function AmountRow({ label, amount, total = false }: { label: string; amount: string; total?: boolean }) {
    return <div className={`flex items-start justify-between gap-4 py-3 ${total ? 'border-t font-semibold' : ''}`}><span>{label}</span><span className="text-right tabular-nums whitespace-nowrap">{formatNgn(amount)}</span></div>;
}

export default function ReportsPage() {
    const [pnlData, setPnlData] = useState<IncomeStatement | null>(null);
    const [balanceData, setBalanceData] = useState<BalanceSheet | null>(null);
    const [pnlError, setPnlError] = useState('');
    const [balanceError, setBalanceError] = useState('');
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    const monthDate = new Date(`${today}T12:00:00`);
    const periodLabel = format(monthDate, 'MMMM yyyy');
    const periodStart = format(startOfMonth(monthDate), 'yyyy-MM-dd');
    const periodEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd');
    useEffect(() => {
        let active = true;
        setLoading(true); setPnlError(''); setBalanceError('');
        void Promise.allSettled([getProfitAndLossAction(periodStart, periodEnd), getBalanceSheetAction()]).then(([income, balance]) => {
            if (!active) return;
            if (income.status === 'fulfilled' && income.value.success && income.value.data) setPnlData(income.value.data);
            else { setPnlData(null); setPnlError(income.status === 'fulfilled' ? income.value.error || 'Income statement unavailable.' : 'Income statement unavailable. Please retry.'); }
            if (balance.status === 'fulfilled' && balance.value.success && balance.value.data) setBalanceData(balance.value.data);
            else { setBalanceData(null); setBalanceError(balance.status === 'fulfilled' ? balance.value.error || 'Balance sheet unavailable.' : 'Balance sheet unavailable. Please retry.'); }
            setLoading(false);
        });
        return () => { active = false; };
    }, [periodStart, periodEnd, revision]);
    const retry = () => setRevision(value => value + 1);
    return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-2"><p className="text-sm font-medium text-primary">Financial overview</p><h1 className="font-headline text-3xl font-bold tracking-tight">Financial Reports</h1><p className="text-muted-foreground">Review profitability, financial position and cash movements in one place.</p></header>
        <Tabs defaultValue="pnl" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl border bg-muted/50 p-1.5">
                <TabsTrigger value="pnl" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><BarChart3 className="mr-2 hidden h-4 w-4 sm:block" />Income Statement</TabsTrigger>
                <TabsTrigger value="balance-sheet" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><Landmark className="mr-2 hidden h-4 w-4 sm:block" />Balance Sheet</TabsTrigger>
                <TabsTrigger value="cash-flow" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><ArrowRightLeft className="mr-2 hidden h-4 w-4 sm:block" />Cash Flow Statement</TabsTrigger>
            </TabsList>
            <TabsContent value="pnl" className="mt-6">
                {loading ? <LoadingStatement /> : pnlError ? <StatementError message={pnlError} retry={retry} /> : pnlData && <Card className="rounded-xl"><CardHeader><CardTitle>Income Statement</CardTitle><CardDescription>{periodLabel} Ã‚Â· NGN</CardDescription></CardHeader><CardContent>
                    <div className="overflow-x-auto rounded-lg border"><Table><TableHeader className="bg-muted/50"><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Amount (NGN)</TableHead></TableRow></TableHeader><TableBody>
                        <TableRow><TableCell>Gross Income</TableCell><TableCell className="text-right tabular-nums">{formatNgn(pnlData.income)}</TableCell></TableRow>
                        <TableRow><TableCell>Total Expenses</TableCell><TableCell className="text-right tabular-nums">{formatNgn(pnlData.expenses)}</TableCell></TableRow>
                        <TableRow className="bg-primary/5 font-semibold"><TableCell>{pnlData.netProfit.startsWith('-') ? 'Net Loss' : 'Net Profit'}</TableCell><TableCell className="text-right tabular-nums">{formatNgn(pnlData.netProfit)}</TableCell></TableRow>
                    </TableBody></Table></div>
                </CardContent></Card>}
            </TabsContent>
            <TabsContent value="balance-sheet" className="mt-6">
                {loading ? <LoadingStatement /> : balanceError ? <StatementError message={balanceError} retry={retry} /> : balanceData && <Card className="rounded-xl"><CardHeader><CardTitle>Balance Sheet</CardTitle><CardDescription>As of {format(monthDate, 'd MMMM yyyy')} Ã‚Â· NGN</CardDescription></CardHeader><CardContent>
                    <div className="grid gap-8 lg:grid-cols-2"><section><h2 className="border-b pb-3 font-semibold">Assets</h2><AmountRow label="Cash position" amount={balanceData.assets.cash} /><AmountRow label="Inventory value" amount={balanceData.assets.inventory} /><AmountRow label="Total Assets" amount={balanceData.assets.total} total /></section>
                    <section><h2 className="border-b pb-3 font-semibold">Liabilities and Equity</h2><AmountRow label="Total Liabilities" amount={balanceData.liabilities.total} /><AmountRow label="Capital" amount={balanceData.equity.capital} /><AmountRow label="Retained Earnings" amount={balanceData.equity.retainedEarnings} /><AmountRow label="Total Equity" amount={balanceData.equity.total} total /></section></div>
                    <div className="mt-6 rounded-lg bg-muted/40 px-4"><AmountRow label="Reconciliation difference" amount={balanceData.difference} /></div>
                    {Number(balanceData.difference) !== 0 && <p role="alert" className="mt-3 text-sm text-destructive">This statement does not balance. Review the ledger before using this report.</p>}
                </CardContent></Card>}
            </TabsContent>
            <TabsContent value="cash-flow" className="mt-6"><CashFlowStatement embedded /></TabsContent>
        </Tabs>
    </div>;
}
