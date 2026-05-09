
"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { DataChart } from "@/components/data-chart"
import { 
    ShoppingCart, 
    TrendingUp, 
    Award, 
    ArrowUpRight, 
    ArrowDownRight, 
    Instagram, 
    MessageCircle, 
    Store, 
    Globe, 
    Facebook,
    Activity,
    MousePointerClick,
    Users
} from "lucide-react"
import { ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

const topProductsData = [
    { name: "Premium Widget", sales: 1250, revenue: 37500, trend: "+12%", status: "High Growth" },
    { name: "Advanced Contraption", sales: 450, revenue: 45000, trend: "+8%", status: "Premium" },
    { name: "Standard Gadget", sales: 980, revenue: 19600, trend: "-3%", status: "Stable" },
    { name: "Simple Doohickey", sales: 1100, revenue: 5500, trend: "+24%", status: "Volume Leader" },
    { name: "Basic Thingamajig", sales: 750, revenue: 7500, trend: "+5%", status: "Stable" },
]

const channelPerformanceData = [
    { channel: "WhatsApp", revenue: 42500, conversion: "12.5%", aov: 8500, behavior: "Conversational / Repeat", color: "hsl(var(--chart-1))", icon: MessageCircle },
    { channel: "Instagram", revenue: 35000, conversion: "4.8%", aov: 12500, behavior: "Visual / Impulsive", color: "hsl(var(--chart-2))", icon: Instagram },
    { channel: "Website", revenue: 28000, conversion: "2.4%", aov: 18000, behavior: "Search / Compare", color: "hsl(var(--chart-3))", icon: Globe },
    { channel: "In-Store", revenue: 18500, conversion: "45.0%", aov: 5200, behavior: "Tactile / Immediate", color: "hsl(var(--chart-4))", icon: Store },
    { channel: "Facebook", revenue: 12000, conversion: "1.9%", aov: 7500, behavior: "Community / Referral", color: "hsl(var(--chart-5))", icon: Facebook },
]

const chartConfig = {
    revenue: { label: "Revenue (₦)", color: "hsl(var(--primary))" },
} satisfies ChartConfig

const channelChartConfig = {
    WhatsApp: { label: "WhatsApp", color: "hsl(var(--chart-1))" },
    Instagram: { label: "Instagram", color: "hsl(var(--chart-2))" },
    Website: { label: "Website", color: "hsl(var(--chart-3))" },
    "In-Store": { label: "In-Store", color: "hsl(var(--chart-4))" },
    Facebook: { label: "Facebook", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig

export default function TopSellingPage() {
    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Top-Selling Products & Services</h1>
                <p className="text-muted-foreground mt-1">
                    Identify your most popular offerings and analyze performance across sales channels.
                </p>
            </div>

            {/* Top Stats */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="hover:shadow-md transition-shadow">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Best Selling (Volume)</CardTitle>
                        <div className="bg-primary/10 p-2 rounded-lg">
                            <ShoppingCart className="h-4 w-4 text-primary" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold font-headline">Premium Widget</div>
                        <p className="text-xs text-muted-foreground mt-1">1,250 units sold this month</p>
                    </CardContent>
                </Card>
                <Card className="hover:shadow-md transition-shadow">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Highest Revenue</CardTitle>
                        <div className="bg-emerald-500/10 p-2 rounded-lg">
                            <TrendingUp className="h-4 w-4 text-emerald-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold font-headline">₦45,000</div>
                        <p className="text-xs text-muted-foreground mt-1">Advanced Contraption</p>
                    </CardContent>
                </Card>
                <Card className="hover:shadow-md transition-shadow">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Dominant Channel</CardTitle>
                        <div className="bg-amber-500/10 p-2 rounded-lg">
                            <MessageCircle className="h-4 w-4 text-amber-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold font-headline">WhatsApp</div>
                        <p className="text-xs text-green-600 flex items-center gap-1 font-medium mt-1">
                            <Activity className="h-3 w-3" /> 12.5% Conversion Rate
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Product Performance Section */}
            <div className="grid gap-6 lg:grid-cols-7">
                <Card className="lg:col-span-4">
                    <CardHeader>
                        <CardTitle className="font-headline">Revenue by Product</CardTitle>
                        <CardDescription>Comparison of revenue generated by top 5 products.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-2">
                         <DataChart 
                            type="bar" 
                            data={topProductsData} 
                            config={chartConfig} 
                            dataKeys={['revenue']} 
                            index="name" 
                        />
                    </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                    <CardHeader>
                        <CardTitle className="font-headline">Sales Velocity</CardTitle>
                        <CardDescription>Monthly unit sales trend.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Sales</TableHead>
                                        <TableHead className="text-right">Trend</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topProductsData.map((item) => (
                                        <TableRow key={item.name}>
                                            <TableCell className="font-medium text-sm">{item.name}</TableCell>
                                            <TableCell className="text-right text-sm">{item.sales.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">
                                                <span className={cn("text-xs font-bold flex items-center justify-end gap-1", item.trend.startsWith('+') ? "text-green-600" : "text-red-600")}>
                                                    {item.trend.startsWith('+') ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                                    {item.trend}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Channel Insights Section */}
            <div className="space-y-6">
                <div>
                    <h2 className="font-headline text-2xl font-bold">Sales Channel Intelligence</h2>
                    <p className="text-muted-foreground text-sm">Where your customers are buying and how they behave.</p>
                </div>

                <div className="grid gap-6 lg:grid-cols-7">
                    <Card className="lg:col-span-3">
                        <CardHeader>
                            <CardTitle className="font-headline">Revenue Breakdown by Channel</CardTitle>
                            <CardDescription>Visualizing income distribution across platforms.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DataChart 
                                type="pie" 
                                variant="donut"
                                data={channelPerformanceData} 
                                config={channelChartConfig} 
                                dataKeys={['revenue']} 
                                index="channel" 
                            />
                        </CardContent>
                    </Card>

                    <Card className="lg:col-span-4">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="font-headline">Channel Conversion & Behavior</CardTitle>
                                    <CardDescription>Efficiency metrics and qualitative patterns.</CardDescription>
                                </div>
                                <Activity className="h-5 w-5 text-muted-foreground opacity-20" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead>Channel</TableHead>
                                            <TableHead className="text-center"><MousePointerClick className="h-4 w-4 mx-auto" /></TableHead>
                                            <TableHead className="text-right">AOV</TableHead>
                                            <TableHead className="hidden md:table-cell">Pattern</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {channelPerformanceData.map((channel) => (
                                            <TableRow key={channel.channel}>
                                                <TableCell className="font-bold">
                                                    <div className="flex items-center gap-2">
                                                        <channel.icon className="h-4 w-4 text-muted-foreground" />
                                                        {channel.channel}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="secondary" className="bg-primary/5 text-primary text-[10px]">
                                                        {channel.conversion}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-xs">
                                                    ₦{channel.aov.toLocaleString()}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                                        {channel.behavior}
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="mt-4 p-4 bg-primary/5 rounded-xl border border-dashed border-primary/20">
                                <div className="flex items-start gap-3">
                                    <Users className="h-5 w-5 text-primary mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-primary uppercase">Key Recommendation</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            <strong>WhatsApp</strong> shows the highest conversion (12.5%). Consider reallocating Instagram marketing spend to WhatsApp Business automation to drive higher volume.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Detailed Offering Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Detailed Performance Report</CardTitle>
                    <CardDescription>A complete look at product and service rankings by performance.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product/Service Name</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="text-right">Units Sold</TableHead>
                                    <TableHead className="text-right">Total Revenue</TableHead>
                                    <TableHead className="text-center">Market Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {topProductsData.map((item) => (
                                    <TableRow key={item.name}>
                                        <TableCell className="font-bold">{item.name}</TableCell>
                                        <TableCell>Inventory Item</TableCell>
                                        <TableCell className="text-right">{item.sales.toLocaleString()}</TableCell>
                                        <TableCell className="text-right font-mono font-bold">₦{item.revenue.toLocaleString()}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge 
                                                variant={item.status === "High Growth" ? "default" : "secondary"}
                                                className={item.status === "High Growth" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}
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
        </div>
    )
}
