"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { DataChart } from "@/components/data-chart"
import { ChartConfig } from "@/components/ui/chart"
import { Wallet, TrendingDown, TrendingUp, Scale, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const budgetVsActualData = [
    { month: "Jan", budget: 4500, actual: 4200 },
    { month: "Feb", budget: 4500, actual: 4800 },
    { month: "Mar", budget: 4800, actual: 4600 },
    { month: "Apr", budget: 5000, actual: 5500 },
    { month: "May", budget: 5000, actual: 4900 },
    { month: "Jun", budget: 5500, actual: 6100 },
    { month: "Jul", budget: 6000, actual: 5800 },
]

const categoryVarianceData = [
    { category: "Operations", budget: 500000, actual: 485000, variance: 15000, status: "Under" },
    { category: "Marketing", budget: 200000, actual: 245000, variance: -45000, status: "Over" },
    { category: "Payroll", budget: 1500000, actual: 1500000, variance: 0, status: "On Track" },
    { category: "Technology", budget: 300000, actual: 215000, variance: 85000, status: "Under" },
    { category: "Legal & Admin", budget: 100000, actual: 112000, variance: -12000, status: "Over" },
]

const chartConfig = {
    budget: { label: "Budget (₦)", color: "hsl(var(--muted-foreground))" },
    actual: { label: "Actual (₦)", color: "hsl(var(--primary))" },
} satisfies ChartConfig

function VarianceStatCard({ title, value, subtext, icon: Icon, variant = 'default' }: { title: string, value: string, subtext: string, icon: React.ElementType, variant?: 'default' | 'success' | 'warning' }) {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <div className={cn("p-2 rounded-lg", 
                    variant === 'success' ? "bg-emerald-500/10" : 
                    variant === 'warning' ? "bg-amber-500/10" : "bg-primary/10")}>
                    <Icon className={cn("h-4 w-4", 
                        variant === 'success' ? "text-emerald-600" : 
                        variant === 'warning' ? "text-amber-600" : "text-primary")} 
                    />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    )
}

export default function BudgetVsActualPage() {
    const totalBudget = categoryVarianceData.reduce((acc, curr) => acc + curr.budget, 0);
    const totalActual = categoryVarianceData.reduce((acc, curr) => acc + curr.actual, 0);
    const netVariance = totalBudget - totalActual;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Budget vs. Actual Analysis</h1>
                <p className="text-muted-foreground mt-1">
                    Compare your actual financial performance against your budget to identify variances and optimize spending.
                </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <VarianceStatCard 
                    title="Total Budgeted" 
                    value={`₦${totalBudget.toLocaleString()}`} 
                    subtext="Across all categories" 
                    icon={Wallet} 
                />
                <VarianceStatCard 
                    title="Actual Spending" 
                    value={`₦${totalActual.toLocaleString()}`} 
                    subtext={`${((totalActual / totalBudget) * 100).toFixed(1)}% of total budget`} 
                    icon={Scale} 
                />
                <VarianceStatCard 
                    title="Net Variance" 
                    value={`${netVariance >= 0 ? '+' : ''}₦${netVariance.toLocaleString()}`} 
                    subtext={netVariance >= 0 ? "Under budget (Savings)" : "Over budget (Excess)"} 
                    icon={netVariance >= 0 ? TrendingDown : TrendingUp}
                    variant={netVariance >= 0 ? 'success' : 'warning'}
                />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                    <div className="space-y-1">
                        <CardTitle className="font-headline">Monthly Spending Comparison</CardTitle>
                        <CardDescription>Visual breakdown of budget vs actual costs over time.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="pt-4">
                    <DataChart 
                        type="bar" 
                        data={budgetVsActualData} 
                        config={chartConfig} 
                        dataKeys={['budget', 'actual']} 
                        index="month" 
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Detailed Variance Report</CardTitle>
                    <CardDescription>Category-by-category analysis of budget utilization.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Expense Category</TableHead>
                                    <TableHead className="text-right">Budgeted</TableHead>
                                    <TableHead className="text-right">Actual</TableHead>
                                    <TableHead className="text-right">Variance</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {categoryVarianceData.map((item) => {
                                    const pctVariance = ((item.actual - item.budget) / item.budget) * 100;
                                    return (
                                        <TableRow key={item.category}>
                                            <TableCell className="font-medium">{item.category}</TableCell>
                                            <TableCell className="text-right font-mono">₦{item.budget.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-mono">₦{item.actual.toLocaleString()}</TableCell>
                                            <TableCell className={cn("text-right font-mono font-bold", item.variance >= 0 ? "text-emerald-600" : "text-red-600")}>
                                                {item.variance >= 0 ? '+' : ''}₦{item.variance.toLocaleString()}
                                                <div className="text-[10px] font-normal opacity-70">
                                                    {pctVariance.toFixed(1)}% variance
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge 
                                                    variant={item.status === "Over" ? "destructive" : item.status === "Under" ? "default" : "secondary"}
                                                    className={cn(
                                                        item.status === "Under" && "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
                                                        item.status === "On Track" && "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20"
                                                    )}
                                                >
                                                    {item.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-primary/5 border-dashed border-2">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">Critical Insights</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div className="flex gap-3">
                            <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                            <p><strong>Marketing</strong> is 22.5% over budget due to higher-than-expected acquisition costs in Q3. Recommendation: Reallocate from R&D.</p>
                        </div>
                        <div className="flex gap-3">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                            <p><strong>Technology</strong> savings of ₦85,000 realized by migrating to regional server clusters in Lagos.</p>
                        </div>
                    </CardContent>
                </Card>
                <div className="flex flex-col justify-center gap-4 text-center md:text-left p-6">
                    <h3 className="font-headline text-xl font-bold">Optimize Your Cash Flow</h3>
                    <p className="text-muted-foreground text-sm">
                        Use these variances to adjust your next month&apos;s planning. Our AI Assistant can help you find ways to cut costs in over-budget categories.
                    </p>
                    <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                        <Badge variant="outline" className="px-3 py-1 cursor-pointer hover:bg-primary/5">Adjust Budget</Badge>
                        <Badge variant="outline" className="px-3 py-1 cursor-pointer hover:bg-primary/5">Export Variance PDF</Badge>
                    </div>
                </div>
            </div>
        </div>
    )
}
