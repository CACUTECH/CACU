
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import React from 'react';
import { format, startOfMonth, endOfMonth } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import { getProfitAndLossAction, getBalanceSheetAction } from "./actions"

export default function ReportsPage() {
    const [loading, setLoading] = React.useState(true);
    const [pnlData, setPnlData] = React.useState<any>(null);
    const [balanceData, setBalanceData] = React.useState<any>(null);
    const { toast } = useToast();

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        const start = startOfMonth(new Date()).toISOString();
        const end = endOfMonth(new Date()).toISOString();

        const [pnlRes, balRes] = await Promise.all([
            getProfitAndLossAction(start, end),
            getBalanceSheetAction()
        ]);

        if (pnlRes.success) setPnlData(pnlRes.data);
        if (balRes.success) setBalanceData(balRes.data);
        setLoading(false);
    }, []);

    React.useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Financial Intelligence</h1>
                    <p className="text-muted-foreground">Real-time reports derived from your relational ledger.</p>
                </div>
            </div>

            <Tabs defaultValue="pnl">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-primary/5 border border-primary/10 rounded-xl">
                    <TabsTrigger value="pnl" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Profit & Loss</TabsTrigger>
                    <TabsTrigger value="balance-sheet" className="rounded-lg data-[state=active]:bg-amber-600 data-[state=active]:text-white">Balance Sheet</TabsTrigger>
                </TabsList>

                <TabsContent value="pnl" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Profit & Loss Statement</CardTitle>
                            <CardDescription>Period: {format(new Date(), "MMMM yyyy")}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Amount (₦)</TableHead></TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        <TableRow className="font-bold"><TableCell>Gross Income</TableCell><TableCell className="text-right">₦{pnlData?.income.toLocaleString()}</TableCell></TableRow>
                                        <TableRow className="font-bold"><TableCell>Total Expenses</TableCell><TableCell className="text-right text-red-600">(₦{pnlData?.expenses.toLocaleString()})</TableCell></TableRow>
                                        <TableRow className="bg-primary/5 font-bold text-lg border-t-2">
                                            <TableCell>Net Profit</TableCell>
                                            <TableCell className="text-right text-primary">₦{pnlData?.netProfit.toLocaleString()}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="balance-sheet" className="mt-6">
                    <Card>
                        <CardHeader><CardTitle>Balance Sheet Snapshot</CardTitle></CardHeader>
                        <CardContent>
                             <div className="grid gap-8 md:grid-cols-2">
                                <div className="space-y-4">
                                    <h3 className="font-bold text-lg border-b pb-2">Assets</h3>
                                    <div className="flex justify-between"><span>Cash position</span><span className="font-mono">₦{balanceData?.assets.cash.toLocaleString()}</span></div>
                                    <div className="flex justify-between"><span>Inventory value</span><span className="font-mono">₦{balanceData?.assets.inventory.toLocaleString()}</span></div>
                                    <div className="flex justify-between font-bold pt-2 border-t"><span>Total Assets</span><span>₦{balanceData?.assets.total.toLocaleString()}</span></div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="font-bold text-lg border-b pb-2">Equity</h3>
                                    <div className="flex justify-between"><span>Retained Earnings</span><span className="font-mono">₦{balanceData?.equity.retainedEarnings.toLocaleString()}</span></div>
                                    <div className="flex justify-between font-bold pt-2 border-t"><span>Total Equity</span><span>₦{balanceData?.equity.total.toLocaleString()}</span></div>
                                </div>
                             </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
