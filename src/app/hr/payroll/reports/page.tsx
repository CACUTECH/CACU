
"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, FileSpreadsheet, BarChart3, TrendingUp, PieChart, Users, Wallet, Calendar } from "lucide-react";
import Link from "next/link";
import { employees, payrollHistory } from "@/lib/data";
import { DataChart } from "@/components/data-chart";
import { ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  wages: { label: "Total Wages", color: "hsl(var(--primary))" },
  statutory: { label: "Statutory Liability", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

export default function PayrollAnalyticsPage() {
    const latestRun = payrollHistory[0];
    
    const departmentCostData = React.useMemo(() => {
        const departments = [...new Set(employees.map(e => e.department || 'Other'))];
        return departments.map(dept => {
            const cost = employees
                .filter(e => e.department === dept)
                .reduce((sum, e) => sum + e.baseSalary, 0);
            return { category: dept, value: cost };
        });
    }, []);

    const historicalTrend = payrollHistory.slice().reverse().map(run => ({
        month: run.month.split(' ')[0],
        wages: run.totalPaid,
        statutory: run.totalDeductions
    }));

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon" className="rounded-full">
                        <Link href="/hr/payroll"><ArrowLeft className="h-4 w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="font-headline text-3xl font-bold">Workforce Cost Analysis</h1>
                        <p className="text-muted-foreground">Strategic payroll analytics and YTD workforce spend.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="rounded-xl"><FileSpreadsheet className="mr-2 h-4 w-4" /> Export Register</Button>
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <InsightCard title="Total YTD Gross" value="₦14.2M" subtext="Across all subsidiaries" icon={Wallet} />
                <InsightCard title="Headcount" value={employees.length.toString()} subtext="Active participants" icon={Users} />
                <InsightCard title="Avg. Burden Rate" value="1.15x" subtext="Benefits vs Base Pay" icon={TrendingUp} />
                <InsightCard title="Last Payout" value={`₦${latestRun.totalPaid.toLocaleString()}`} subtext={latestRun.month} icon={Calendar} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="shadow-xl shadow-primary/5">
                    <CardHeader>
                        <CardTitle className="font-headline text-xl">Payroll Spend Trend</CardTitle>
                        <CardDescription>Gross wages vs. statutory liabilities (6 months).</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <DataChart 
                            type="area" 
                            data={historicalTrend} 
                            config={chartConfig} 
                            dataKeys={['wages', 'statutory']} 
                            index="month" 
                        />
                    </CardContent>
                </Card>

                <Card className="shadow-xl shadow-primary/5">
                    <CardHeader>
                        <CardTitle className="font-headline text-xl">Cost by Department</CardTitle>
                        <CardDescription>Workforce cost distribution by functional unit.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <DataChart 
                            type="pie" 
                            variant="donut"
                            data={departmentCostData} 
                            config={{
                                category: { label: "Department", color: "hsl(var(--primary))" }
                            } as any} 
                            dataKeys={['value']} 
                            index="category" 
                        />
                    </CardContent>
                </Card>
            </div>

            <Card className="border-primary/10 shadow-xl shadow-primary/5">
                <CardHeader>
                    <CardTitle className="font-headline">Cost Center Reconciliation</CardTitle>
                    <CardDescription>Detailed breakdown of employee costs per strategic cost center.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Cost Center</TableHead>
                                <TableHead>Department</TableHead>
                                <TableHead className="text-right">Headcount</TableHead>
                                <TableHead className="text-right pr-6">Monthly Cost (₦)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {departmentCostData.map((d, idx) => (
                                <TableRow key={idx}>
                                    <TableCell className="pl-6 font-mono text-xs font-bold text-primary">{d.category.substring(0,3).toUpperCase()}-001</TableCell>
                                    <TableCell className="font-medium">{d.category}</TableCell>
                                    <TableCell className="text-right">{employees.filter(e => (e.department || 'Other') === d.category).length}</TableCell>
                                    <TableCell className="text-right pr-6 font-bold">₦{d.value.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function InsightCard({ title, value, subtext, icon: Icon }: any) {
    return (
        <Card className="shadow-lg border-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-[10px] text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    );
}
