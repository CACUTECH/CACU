"use client";

import Link from 'next/link';
import { BarChart3, Landmark, ArrowRightLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinancialStatementsPanel } from '@/components/financial-statements';
import CashFlowStatement from '@/app/accounting/cash-flow/cash-flow-statement';

export default function ReportsPage() {
    return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-2"><p className="text-sm font-medium text-primary">Financial overview</p><h1 className="font-headline text-3xl font-bold tracking-tight">Financial Reports</h1><p className="text-muted-foreground">Review profitability, financial position and cash movements in one place.</p></header>
        <Link href="/accounting/policies" className="text-primary underline">Complete financial close: equity, OCI, policies, notes and supporting schedules</Link>
        <Tabs defaultValue="pnl" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl border bg-muted/50 p-1.5">
                <TabsTrigger value="pnl" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><BarChart3 className="mr-2 hidden h-4 w-4 sm:block" />Income Statement</TabsTrigger>
                <TabsTrigger value="balance-sheet" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><Landmark className="mr-2 hidden h-4 w-4 sm:block" />Balance Sheet</TabsTrigger>
                <TabsTrigger value="cash-flow" className="min-h-12 whitespace-normal rounded-lg px-2 text-xs sm:text-sm data-[state=active]:shadow-sm"><ArrowRightLeft className="mr-2 hidden h-4 w-4 sm:block" />Cash Flow Statement</TabsTrigger>
            </TabsList>
            <TabsContent value="pnl" className="mt-6"><FinancialStatementsPanel view="income" /></TabsContent>
            <TabsContent value="balance-sheet" className="mt-6"><FinancialStatementsPanel view="position" /></TabsContent>
            <TabsContent value="cash-flow" className="mt-6"><CashFlowStatement embedded /></TabsContent>
        </Tabs>
    </div>;
}
