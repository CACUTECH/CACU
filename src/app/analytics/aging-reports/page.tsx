"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { DataChart } from "@/components/data-chart"
import { ChartConfig } from "@/components/ui/chart"
import { ArrowUpRight, ArrowDownRight, Clock, Wallet, AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

const agingBuckets = [
    { bucket: "Current", receivables: 2450000, payables: 1200000 },
    { bucket: "1-30 Days", receivables: 850000, payables: 450000 },
    { bucket: "31-60 Days", receivables: 420000, payables: 150000 },
    { bucket: "61-90 Days", receivables: 180000, payables: 80000 },
    { bucket: "90+ Days", receivables: 95000, payables: 25000 },
]

const detailedReceivables = [
    { customer: "Alice Johnson", amount: 450000, days: 12, status: "Overdue" },
    { customer: "Bob Williams", amount: 1200000, days: 0, status: "Current" },
    { customer: "Charlie Brown", amount: 350000, days: 45, status: "Overdue" },
    { customer: "Diana Miller", amount: 200000, days: 78, status: "Critical" },
    { customer: "Ethan Davis", amount: 125000, days: 5, status: "Overdue" },
]

const chartConfig = {
    receivables: { label: "Receivables (₦)", color: "hsl(var(--primary))" },
    payables: { label: "Payables (₦)", color: "hsl(var(--destructive))" },
} satisfies ChartConfig

function AgingStatCard({ title, value, count, type }: { title: string, value: string, count: number, type: 'receivables' | 'payables' }) {
    const isReceivable = type === 'receivables'
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <div className={cn("p-2 rounded-lg", isReceivable ? "bg-emerald-500/10" : "bg-red-500/10")}>
                    {isReceivable ? <ArrowUpRight className="h-4 w-4 text-emerald-600" /> : <ArrowDownRight className="h-4 w-4 text-red-600" />}
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                    Outstanding from {count} {isReceivable ? 'customers' : 'vendors'}
                </p>
            </CardContent>
        </Card>
    )
}

export default function AgingReportsPage() {
    const totalReceivables = agingBuckets.reduce((acc, curr) => acc + curr.receivables, 0)
    const totalPayables = agingBuckets.reduce((acc, curr) => acc + curr.payables, 0)

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Receivables & Payables Aging</h1>
                <p className="text-muted-foreground mt-1">
                    Monitor outstanding invoices and bills to manage your cash flow effectively.
                </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <AgingStatCard 
                    title="Total Receivables" 
                    value={`₦${totalReceivables.toLocaleString()}`} 
                    count={detailedReceivables.length}
                    type="receivables"
                />
                <AgingStatCard 
                    title="Total Payables" 
                    value={`₦${totalPayables.toLocaleString()}`} 
                    count={3}
                    type="payables"
                />
                <Card className="lg:col-span-2 bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Clock className="h-4 w-4 text-primary" />
                            Cash Flow Forecast
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl font-bold text-primary">₦{(totalReceivables - totalPayables).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground mt-1">Net position if all current obligations are settled.</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Aging Buckets Visualization</CardTitle>
                    <CardDescription>Breakdown of outstanding amounts by overdue period.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                    <DataChart 
                        type="bar" 
                        data={agingBuckets} 
                        config={chartConfig} 
                        dataKeys={['receivables', 'payables']} 
                        index="bucket" 
                    />
                </CardContent>
            </Card>

            <Tabs defaultValue="receivables" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-md h-auto p-1 bg-primary/5 border border-primary/10 shadow-xl shadow-primary/5 rounded-xl mb-6">
                    <TabsTrigger 
                        value="receivables"
                        className="py-2.5 rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all shadow-sm"
                    >
                        <Wallet className="h-4 w-4 mr-2" /> Accounts Receivable
                    </TabsTrigger>
                    <TabsTrigger 
                        value="payables"
                        className="py-2.5 rounded-lg data-[state=active]:bg-red-600 data-[state=active]:text-white transition-all shadow-sm"
                    >
                        <AlertCircle className="h-4 w-4 mr-2" /> Accounts Payable
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="receivables">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detailed Receivables Aging</CardTitle>
                            <CardDescription>List of customers with outstanding payments.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Customer</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead className="text-center">Days Overdue</TableHead>
                                            <TableHead className="text-right">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detailedReceivables.map((item) => (
                                            <TableRow key={item.customer}>
                                                <TableCell className="font-medium">{item.customer}</TableCell>
                                                <TableCell className="text-right font-mono">₦{item.amount.toLocaleString()}</TableCell>
                                                <TableCell className="text-center">{item.days}</TableCell>
                                                <TableCell className="text-right">
                                                    <Badge 
                                                        variant={item.status === 'Critical' ? 'destructive' : item.status === 'Overdue' ? 'secondary' : 'default'}
                                                        className={cn(
                                                            item.status === 'Current' && "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
                                                            item.status === 'Overdue' && "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20"
                                                        )}
                                                    >
                                                        {item.status}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="payables">
                    <Card>
                        <CardHeader>
                            <CardTitle>Upcoming Bills & Payables</CardTitle>
                            <CardDescription>Monitor your obligations to vendors and suppliers.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                                <CheckCircle2 className="h-8 w-8 mb-2 opacity-20" />
                                <p>No critical overdue payables found.</p>
                                <p className="text-xs">Your accounts payable are currently in good health.</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
