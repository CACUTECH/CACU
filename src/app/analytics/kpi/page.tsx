"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DataChart } from "@/components/data-chart"
import { Users, Wallet, ArrowUpRight, ArrowDownRight, Percent, ShoppingBag } from "lucide-react"
import { ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

const revenueGrowthData = [
    { month: "Jan", revenue: 4500 },
    { month: "Feb", revenue: 5200 },
    { month: "Mar", revenue: 4800 },
    { month: "Apr", revenue: 6100 },
    { month: "May", revenue: 5900 },
    { month: "Jun", revenue: 7200 },
    { month: "Jul", revenue: 8500 },
]

const marginData = [
    { category: "Retail", value: 35 },
    { category: "Services", value: 55 },
    { category: "Digital", value: 75 },
    { category: "Consulting", value: 45 },
]

const chartConfig = {
    revenue: { label: "Revenue (₦)", color: "hsl(var(--primary))" },
    Retail: { label: "Retail", color: "hsl(var(--chart-1))" },
    Services: { label: "Services", color: "hsl(var(--chart-2))" },
    Digital: { label: "Digital", color: "hsl(var(--chart-3))" },
    Consulting: { label: "Consulting", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig

function KpiStatCard({ title, value, change, trend, icon: Icon }: { title: string, value: string, change: string, trend: 'up' | 'down', icon: React.ElementType }) {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <div className={cn("text-xs flex items-center gap-1 mt-1 font-medium", trend === 'up' ? "text-green-600" : "text-red-600")}>
                    {trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {change}
                    <span className="text-muted-foreground ml-1">vs last month</span>
                </div>
            </CardContent>
        </Card>
    )
}

export default function KpiPage() {
    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Key Performance Indicators (KPIs)</h1>
                <p className="text-muted-foreground mt-1">
                    Track your most important business metrics at a glance with a customizable dashboard.
                </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <KpiStatCard 
                    title="Net Profit Margin" 
                    value="24.5%" 
                    change="+4.2%" 
                    trend="up" 
                    icon={Percent} 
                />
                <KpiStatCard 
                    title="Avg. Transaction Value" 
                    value="₦12,450" 
                    change="+12%" 
                    trend="up" 
                    icon={Wallet} 
                />
                <KpiStatCard 
                    title="Customer Retention" 
                    value="82%" 
                    change="-2%" 
                    trend="down" 
                    icon={Users} 
                />
                <KpiStatCard 
                    title="Inventory Turnover" 
                    value="4.5x" 
                    change="+0.8x" 
                    trend="up" 
                    icon={ShoppingBag} 
                />
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
                <Card className="lg:col-span-4">
                    <CardHeader>
                        <CardTitle className="font-headline">Revenue Growth Trend</CardTitle>
                        <CardDescription>Monthly revenue performance over the last 7 months.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-2">
                        <DataChart 
                            type="area" 
                            data={revenueGrowthData} 
                            config={chartConfig} 
                            dataKeys={['revenue']} 
                            index="month" 
                        />
                    </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                    <CardHeader>
                        <CardTitle className="font-headline">Profitability by Sector</CardTitle>
                        <CardDescription>Breakdown of profit margins across business units.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DataChart 
                            type="pie" 
                            variant="donut"
                            data={marginData} 
                            config={chartConfig} 
                            dataKeys={['value']} 
                            index="category" 
                        />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Efficiency Metrics</CardTitle>
                    <CardDescription>Operational performance indicators for your business ecosystem.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-8 md:grid-cols-3">
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-muted-foreground">Order Fulfillment Time</div>
                            <div className="text-3xl font-bold font-headline">1.4 Days</div>
                            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 w-[85%]" />
                            </div>
                            <p className="text-xs text-muted-foreground">Top 10% of industry average</p>
                        </div>
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-muted-foreground">Marketing ROI</div>
                            <div className="text-3xl font-bold font-headline">4.2x</div>
                            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 w-[65%]" />
                            </div>
                            <p className="text-xs text-muted-foreground">Target: 5.0x for Q4</p>
                        </div>
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-muted-foreground">Debt-to-Equity Ratio</div>
                            <div className="text-3xl font-bold font-headline">0.32</div>
                            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 w-[32%]" />
                            </div>
                            <p className="text-xs text-muted-foreground">Low risk financial health</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
