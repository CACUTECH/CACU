
"use client"

import * as React from 'react';
import { 
    Users, 
    Calendar as CalendarIcon, 
    TrendingUp, 
    PieChart, 
    Clock, 
    Wrench, 
    Package, 
    CheckCircle2, 
    AlertCircle, 
    ArrowRight,
    TrendingDown,
    Activity,
    Target,
    NFC
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { transactions, incomeVsExpenseData, expensesByCategoryData, jobs, appointments } from '@/lib/data';
import type { BusinessType } from '@/lib/data';
import { DataChart } from '@/components/data-chart';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ChartConfig } from '@/components/ui/chart';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const chartConfig = {
  "Services": { label: "Services", color: "hsl(var(--chart-1))" },
  "Wages": { label: "Wages", color: "hsl(var(--chart-2))" },
  "Rent": { label: "Rent", color: "hsl(var(--chart-3))" },
  "Supplies": { label: "Supplies", color: "hsl(var(--chart-4))" },
  "Marketing": { label: "Marketing", color: "hsl(var(--chart-5))" },
} satisfies ChartConfig;

const NairaIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 3v18" />
    <path d="M6 3l12 18" />
    <path d="M18 3v18" />
    <path d="M4 10h16" />
    <path d="M4 14h16" />
  </svg>
);

function StatCard({ title, value, subtext, icon: Icon, trend, variant = 'default' }: any) {
    return (
        <Card className={cn(
            "shadow-lg border-primary/5 transition-all hover:shadow-primary/10",
            variant === 'primary' && "bg-primary text-primary-foreground border-none"
        )}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className={cn("text-xs font-bold uppercase tracking-widest", variant === 'primary' ? "opacity-80" : "text-muted-foreground")}>
                    {title}
                </CardTitle>
                <div className={cn("p-2 rounded-lg", variant === 'primary' ? "bg-white/20" : "bg-primary/10")}>
                    <Icon className={cn("h-4 w-4", variant === 'primary' ? "text-white" : "text-primary")} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                {subtext && (
                    <div className="flex items-center gap-1 mt-1">
                        {trend === 'up' ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : trend === 'down' ? <TrendingDown className="h-3 w-3 text-red-500" /> : null}
                        <p className={cn("text-[10px] font-medium", variant === 'primary' ? "opacity-80" : "text-muted-foreground")}>{subtext}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export default function DashboardPage() {
  const [businessType, setBusinessType] = React.useState<BusinessType>('HYBRID');
  const [granularity, setGranularity] = React.useState<'daily' | 'weekly' | 'monthly' | 'quarterly'>('monthly');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const savedType = localStorage.getItem('business-type') as BusinessType;
    if (savedType) setBusinessType(savedType);
  }, []);

  const performanceData = React.useMemo(() => {
    switch (granularity) {
      case 'daily':
        return [
          { month: 'Mon', income: 1200, expense: 800 },
          { month: 'Tue', income: 900, expense: 1100 },
          { month: 'Wed', income: 1500, expense: 700 },
          { month: 'Thu', income: 1800, expense: 950 },
          { month: 'Fri', income: 2200, expense: 1200 },
          { month: 'Sat', income: 1100, expense: 400 },
          { month: 'Sun', income: 800, expense: 300 },
        ];
      case 'weekly':
        return [
          { month: 'Week 1', income: 8500, expense: 4200 },
          { month: 'Week 2', income: 9200, expense: 5100 },
          { month: 'Week 3', income: 7800, expense: 3900 },
          { month: 'Week 4', income: 11500, expense: 6200 },
        ];
      case 'monthly':
        return incomeVsExpenseData;
      case 'quarterly':
        return [
          { month: 'Q1', income: 35000, expense: 18000 },
          { month: 'Q2', income: 42000, expense: 22000 },
          { month: 'Q3', income: 38000, expense: 19500 },
          { month: 'Q4', income: 51000, expense: 28000 },
        ];
      default:
        return incomeVsExpenseData;
    }
  }, [granularity]);

  if (!mounted) return null;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-foreground">Control Center</h1>
          <p className="text-muted-foreground mt-1">
            Performance metrics for your <span className="text-primary font-bold">{businessType.toLowerCase()}</span> operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-3 py-1 bg-primary/5 text-primary border-primary/10 font-bold uppercase tracking-tighter">
                {businessType} Mode
            </Badge>
            <Button asChild size="sm" variant="outline" className="rounded-xl">
                <Link href="/reports">Full Reports</Link>
            </Button>
        </div>
      </div>

      {/* Dynamic Stat Cards Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard 
            title="Revenue MTD" 
            value="₦1,240,500" 
            subtext="+14.2% vs last month" 
            trend="up" 
            icon={NairaIcon} 
            variant="primary" 
        />
        
        {/* Metric 2: Contextual based on business type */}
        {businessType === 'HYBRID' ? (
             <StatCard 
                title="Jobs Completion" 
                value="92%" 
                subtext="24 active orders" 
                trend="up" 
                icon={Wrench} 
            />
        ) : businessType === 'SERVICE' ? (
            <StatCard 
                title="Service Revenue" 
                value="₦842k" 
                subtext="MTD billable services" 
                trend="up" 
                icon={Target} 
            />
        ) : (
             <StatCard 
                title="Sales Volume" 
                value="842" 
                subtext="Total units sold MTD" 
                trend="up" 
                icon={Package} 
            />
        )}

        {/* Metric 3: Contextual based on business type */}
        {businessType === 'HYBRID' ? (
            <StatCard 
                title="Sales Volume" 
                value="842" 
                subtext="MTD product turnover" 
                trend="up" 
                icon={Package} 
            />
        ) : businessType === 'SERVICE' ? (
            <StatCard 
                title="Today's Appts" 
                value="5" 
                subtext="Next: 10:00 AM" 
                icon={Clock} 
            />
        ) : (
            <StatCard 
                title="Inventory Health" 
                value="85%" 
                subtext="4 items low stock" 
                trend="down" 
                icon={Activity} 
            />
        )}

        <StatCard 
            title="Customer Base" 
            value="148" 
            subtext="12 new additions" 
            trend="up" 
            icon={Users} 
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        <Card className="lg:col-span-4 shadow-xl shadow-primary/5 border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="space-y-1">
              <CardTitle className="font-headline text-xl">Revenue Flow</CardTitle>
              <CardDescription>Performance trends for your business</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={granularity} onValueChange={(v: any) => setGranularity(v)}>
                <SelectTrigger className="w-[120px] h-8 text-xs rounded-xl">
                  <SelectValue placeholder="Granularity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
              <Target className="h-5 w-5 text-primary/20" />
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <DataChart 
              type="area" 
              data={performanceData} 
              config={{
                income: { label: "Income", color: "#22c55e" },
                expense: { label: "Expense", color: "#ef4444" },
              }} 
              dataKeys={['income', 'expense']} 
              index="month" 
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 shadow-xl shadow-primary/5 border-primary/10">
          <CardHeader>
            <CardTitle className="font-headline text-xl">Operational Split</CardTitle>
            <CardDescription>Expense distribution analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <DataChart 
              type="pie" 
              data={expensesByCategoryData} 
              config={chartConfig} 
              dataKeys={['value']} 
              index="category" 
              variant="donut"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hybrid & Service: Active Jobs Section */}
        {(businessType === 'SERVICE' || businessType === 'HYBRID') && (
            <Card className="shadow-lg border-primary/5">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="font-headline">Service Workboard</CardTitle>
                            <CardDescription>Live tracking of active work orders.</CardDescription>
                        </div>
                        <Button asChild variant="ghost" size="sm">
                            <Link href="/jobs">View Board <ArrowRight className="ml-2 h-4 w-4" /></Link>
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Customer</TableHead>
                                <TableHead>Job Title</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {jobs.slice(0, 5).map((job) => (
                                <TableRow key={job.id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                                    <TableCell>
                                        <div className="font-bold text-sm">{job.customerName}</div>
                                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Due {job.dueDate}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">{job.title}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold">₦{job.totalAmount.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        )}

        {/* Hybrid & Product: Inventory Intelligence Section */}
        {(businessType === 'PRODUCT' || businessType === 'HYBRID') && (
            <Card className="shadow-lg border-primary/5">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="font-headline">Stock Intelligence</CardTitle>
                            <CardDescription>Critical reorder alerts and velocity.</CardDescription>
                        </div>
                        <Button asChild variant="ghost" size="sm">
                            <Link href="/catalog">Inventory <ArrowRight className="ml-2 h-4 w-4" /></Link>
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                        <Package className="h-10 w-10 opacity-20 mb-2" />
                        <p className="text-sm font-medium">All critical stock levels are healthy.</p>
                        <p className="text-[10px] uppercase font-bold mt-1">Automatic scan active</p>
                    </div>
                </CardContent>
            </Card>
        )}

        {/* Global Recent Activity (shows for everyone) */}
        <Card className={cn(
            "shadow-lg border-primary/5",
            businessType === 'HYBRID' ? "lg:col-span-2" : ""
        )}>
          <CardHeader>
            <div className="flex items-center justify-between">
                <div>
                    <CardTitle className="font-headline">Recent Activity</CardTitle>
                    <CardDescription>Latest financial and operational events.</CardDescription>
                </div>
                <div className="bg-emerald-500/10 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-bold border border-emerald-500/20 flex items-center gap-2">
                    <Activity className="h-3 w-3" /> System Synchronized
                </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={cn(
                "space-y-4",
                businessType === 'HYBRID' ? "grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4" : ""
            )}>
                {transactions.slice(0, 6).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl border border-dashed hover:bg-muted/20 transition-all cursor-pointer">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "p-2 rounded-lg",
                                tx.type === 'Income' ? "bg-emerald-500/10" : "bg-red-500/10"
                            )}>
                                {tx.type === 'Income' ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
                            </div>
                            <div>
                                <p className="text-sm font-bold">{tx.description}</p>
                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">{tx.date}</p>
                            </div>
                        </div>
                        <div className={cn(
                            "font-mono font-bold",
                            tx.type === 'Income' ? "text-emerald-600" : "text-red-600"
                        )}>
                            {tx.type === 'Income' ? '+' : '-'}₦{tx.amount.toLocaleString()}
                        </div>
                    </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-br from-indigo-600 to-primary border-none shadow-2xl shadow-primary/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
        <CardContent className="p-10 text-white relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="max-w-xl space-y-4 text-center md:text-left">
                    <h2 className="text-3xl font-bold font-headline">Ready to expand?</h2>
                    <p className="text-white/80 leading-relaxed text-sm">
                        You are currently optimizing for **{businessType}** operations. You can adjust your business model at any time in settings to unlock new modules or dashboards tailored for your growth.
                    </p>
                    <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                        <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold px-8">
                            Upgrade Plan
                        </Button>
                        <Button asChild variant="outline" className="border-white/20 text-white hover:bg-white/10">
                            <Link href="/settings/business">Switch Model</Link>
                        </Button>
                    </div>
                </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
