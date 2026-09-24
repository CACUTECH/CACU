
"use client"

import * as React from 'react';
import { 
    TrendingUp, 
    Clock, 
    Wrench, 
    Package, 
    Activity, 
    TrendingDown,
    Receipt,
    PlusCircle,
    MonitorSpeaker,
    ArrowLeftRight,
    Users,
    Calendar as CalendarIcon,
    Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataChart } from '@/components/data-chart';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBusiness } from '@/components/business-provider';
import { getDashboardStatsAction, getRevenueTrendAction } from './reports/actions';

function StatCard({ title, value, subtext, icon: Icon, trend, variant = 'default' }: any) {
    return (
        <Card className={cn(
            "shadow-lg border-primary/5 transition-all hover:shadow-primary/10",
            variant === 'primary' && "bg-primary text-primary-foreground border-none"
        )}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className={cn("text-[10px] font-bold uppercase tracking-widest", variant === 'primary' ? "text-white/80" : "text-muted-foreground")}>
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
                        <p className={cn("text-[10px] font-medium", variant === 'primary' ? "text-white/70" : "text-muted-foreground")}>{subtext}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function QuickAction({ icon: Icon, label, href, color = 'bg-primary' }: any) {
    return (
        <Link href={href} className="flex flex-col items-center gap-2 group flex-1 min-w-[80px]">
            <div className={cn(
                "h-12 w-12 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 group-hover:shadow-lg shadow-sm text-white",
                color
            )}>
                <Icon className="h-6 w-6" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground group-hover:text-primary transition-colors text-center whitespace-nowrap">
                {label}
            </span>
        </Link>
    )
}

export default function DashboardPage() {
  const { business } = useBusiness();
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState<any>(null);
  const [trendData, setTrendData] = React.useState<any[]>([]);
  const [granularity, setGranularity] = React.useState<'day' | 'week' | 'month'>('month');

  const fetchData = React.useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const start = startOfMonth(new Date()).toISOString();
    const end = endOfMonth(new Date()).toISOString();

    const [statsRes, trendRes] = await Promise.all([
      getDashboardStatsAction(start, end),
      getRevenueTrendAction(start, end, granularity)
    ]);

    if (statsRes.success) setStats(statsRes.data);
    if (trendRes.success) setTrendData(trendRes.data);
    setLoading(false);
  }, [business, granularity]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !stats) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-foreground">Business Snapshot</h1>
          <p className="text-muted-foreground mt-1">
            Real-time performance for <span className="text-primary font-bold">{business?.name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-3 py-1 bg-primary/5 text-primary border-primary/10 font-bold uppercase tracking-tighter">
                {business?.business_type} Mode
            </Badge>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard 
            title="Revenue (MTD)" 
            value={`₦${Number(stats?.financials?.total_income || 0).toLocaleString()}`} 
            subtext={`${stats?.financials?.transaction_count || 0} events`} 
            trend="up" 
            icon={TrendingUp} 
            variant="primary" 
        />
        
        <StatCard 
            title="Active Work Orders" 
            value={stats?.jobs?.activeCount || 0} 
            subtext="In execution pipeline" 
            icon={Wrench} 
        />

        <StatCard 
            title="Inventory Health" 
            value={`${stats?.inventory?.total_items || 0} units`} 
            subtext={`${stats?.inventory?.low_stock_count || 0} restock alerts`} 
            trend={stats?.inventory?.low_stock_count > 0 ? "down" : "up"} 
            icon={Package} 
        />

        <StatCard 
            title="Net Profit" 
            value={`₦${Number(stats?.financials?.net_profit || 0).toLocaleString()}`} 
            subtext="Current month position" 
            trend={stats?.financials?.net_profit >= 0 ? "up" : "down"} 
            icon={Activity} 
        />
      </div>

      <Card className="border-primary/10 shadow-lg shadow-primary/5">
        <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 overflow-x-auto">
                <QuickAction icon={Receipt} label="New Invoice" href="/invoices" color="bg-indigo-600" />
                <QuickAction icon={ArrowLeftRight} label="Transaction" href="/transactions" color="bg-emerald-600" />
                <QuickAction icon={MonitorSpeaker} label="POS Sale" href="/pos" color="bg-violet-600" />
                <QuickAction icon={Users} label="Customer" href="/customers" color="bg-blue-600" />
                <QuickAction icon={PlusCircle} label="Add Item" href="/catalog" color="bg-rose-600" />
            </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-7">
        <Card className="lg:col-span-7 shadow-xl shadow-primary/5 border-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="space-y-1">
              <CardTitle className="font-headline text-xl">Financial Performance Trend</CardTitle>
              <CardDescription>Server-aggregated income vs. expense flow.</CardDescription>
            </div>
            <Select value={granularity} onValueChange={(v: any) => setGranularity(v)}>
                <SelectTrigger className="w-[120px] h-8 text-xs rounded-xl">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="day">Daily</SelectItem>
                    <SelectItem value="week">Weekly</SelectItem>
                    <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="pt-6">
            <DataChart 
              type="area" 
              data={trendData} 
              config={{
                income: { label: "Income", color: "#22c55e" },
                expense: { label: "Expense", color: "#ef4444" },
              }} 
              dataKeys={['income', 'expense']} 
              index="period" 
            />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-br from-indigo-600 to-primary border-none shadow-2xl shadow-primary/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
        <CardContent className="p-10 text-white relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="max-w-xl space-y-4 text-center md:text-left">
                    <h2 className="text-3xl font-bold font-headline">Operational Efficiency</h2>
                    <p className="text-white/80 leading-relaxed text-sm">
                        Your relational ledger is now fully synchronized with PostgreSQL. Reporting and analytics are calculated server-side, ensuring sub-second response times even as your data scales.
                    </p>
                </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
