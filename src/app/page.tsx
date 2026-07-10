
"use client"

import * as React from 'react';
import { Users, Calendar as CalendarIcon, TrendingUp, PieChart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { transactions, incomeVsExpenseData, expensesByCategoryData } from '@/lib/data';
import { DataChart } from '@/components/data-chart';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ChartConfig } from '@/components/ui/chart';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const chartConfig = {
  "Office Supplies": { label: "Office Supplies", color: "hsl(var(--chart-1))" },
  "Software": { label: "Software", color: "hsl(var(--chart-2))" },
  "Meals & Ent.": { label: "Meals & Ent.", color: "hsl(var(--chart-3))" },
  "Contractors": { label: "Contractors", color: "hsl(var(--chart-4))" },
  "Marketing": { label: "Marketing", color: "hsl(var(--chart-5))" },
  "Utilities": { label: "Utilities", color: "hsl(var(--chart-1))" },
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

export default function DashboardPage() {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(2024, 6, 1), // July 1, 2024
    to: new Date(2024, 7, 1),   // August 1, 2024
  });
  
  const [granularity, setGranularity] = React.useState("Month");

  const filteredTransactions = React.useMemo(() => {
    if (!date?.from) return transactions;
    const start = startOfDay(date.from);
    const end = endOfDay(date.to || date.from);
    return transactions.filter(t => {
      const tDate = new Date(t.date);
      return isWithinInterval(tDate, { start, end });
    });
  }, [date]);

  const totalRevenue = React.useMemo(() => filteredTransactions
    .filter((t) => t.type === 'Income')
    .reduce((acc, t) => acc + t.amount, 0), [filteredTransactions]);

  const totalExpenses = React.useMemo(() => filteredTransactions
    .filter((t) => t.type === 'Expense')
    .reduce((acc, t) => acc + t.amount, 0), [filteredTransactions]);

  const netProfit = totalRevenue - totalExpenses;
  
  // Simulated stats based on date range
  const totalCustomers = React.useMemo(() => 44 + Math.floor(filteredTransactions.length / 2), [filteredTransactions]);

  const performanceData = React.useMemo(() => {
    // If granularity is Month but date range is tight, we should still show something
    switch (granularity) {
      case "Day":
        return [
          { period: "Mon", income: 1200, expense: 800 },
          { period: "Tue", income: 1500, expense: 900 },
          { period: "Wed", income: 1100, expense: 1200 },
          { period: "Thu", income: 1800, expense: 1000 },
          { period: "Fri", income: 2200, expense: 1100 },
          { period: "Sat", income: 900, expense: 400 },
          { period: "Sun", income: 1300, expense: 500 },
        ];
      case "Week":
        return [
          { period: "Week 1", income: 4500, expense: 3200 },
          { period: "Week 2", income: 5200, expense: 3800 },
          { period: "Week 3", income: 4800, expense: 4100 },
          { period: "Week 4", income: 6100, expense: 3900 },
        ];
      case "Quarter":
        return [
          { period: "Q1", income: 15000, expense: 11000 },
          { period: "Q2", income: 18500, expense: 13000 },
          { period: "Q3", income: 22000, expense: 15500 },
          { period: "Q4", income: 26000, expense: 18000 },
        ];
      case "Month":
      default:
        // Use static chart data as base but scale slightly with filters for visual effect
        const scale = filteredTransactions.length > 0 ? 1 : 0;
        return incomeVsExpenseData.map(d => ({ 
          period: d.month, 
          income: d.income * (d.month === 'Jul' ? (totalRevenue / 12500 || 1) : 1), 
          expense: d.expense * (d.month === 'Jul' ? (totalExpenses / 1845 || 1) : 1) 
        }));
    }
  }, [granularity, totalRevenue, totalExpenses, filteredTransactions]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, Jane. Here's what's happening with your business.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-full sm:w-[300px] justify-start text-left font-normal shadow-sm bg-background",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, "LLL dd, y")} -{" "}
                      {format(date.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(date.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-lg shadow-green-500/10 border-green-500/20 transition-all hover:shadow-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <NairaIcon className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline text-green-700 dark:text-green-400">₦{totalRevenue.toLocaleString()}</div>
            <p className={cn("text-xs font-medium mt-1", totalRevenue > 0 ? "text-green-500" : "text-muted-foreground")}>
              {totalRevenue > 0 ? "+20.1% from last month" : "No revenue in this period"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-lg shadow-red-500/10 border-red-500/20 transition-all hover:shadow-red-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <NairaIcon className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline text-red-700 dark:text-red-400">₦{totalExpenses.toLocaleString()}</div>
            <p className={cn("text-xs font-medium mt-1", totalExpenses > 0 ? "text-red-500" : "text-muted-foreground")}>
              {totalExpenses > 0 ? "+18.3% from last month" : "No expenses in this period"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-lg shadow-green-500/10 border-green-500/20 transition-all hover:shadow-green-500/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold font-headline", netProfit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600")}>
              ₦{netProfit.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-1">Bottom line for selected range</p>
          </CardContent>
        </Card>
        <Card className="shadow-lg shadow-primary/5 border-primary/10 transition-all hover:shadow-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline text-primary">{totalCustomers}</div>
            <p className="text-xs text-muted-foreground font-medium mt-1">Active relationships</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-3 shadow-xl shadow-primary/5 border-primary/10">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 font-headline text-xl">
                <TrendingUp className="h-5 w-5 text-primary" />
                Performance Trend
              </CardTitle>
              <CardDescription>Income vs Expenses analysis</CardDescription>
            </div>
            <Select value={granularity} onValueChange={setGranularity}>
              <SelectTrigger className="w-[120px] shadow-sm">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Day">Daily</SelectItem>
                <SelectItem value="Week">Weekly</SelectItem>
                <SelectItem value="Month">Monthly</SelectItem>
                <SelectItem value="Quarter">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="pt-4">
            <DataChart 
              type="area" 
              data={performanceData} 
              curveType="monotone" 
              config={{
                income: { label: "Total Income", color: "#22c55e" },
                expense: { label: "Total Expense", color: "#ef4444" },
              }} 
              dataKeys={['income', 'expense']} 
              index="period" 
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2 shadow-xl shadow-primary/5 border-primary/10">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 font-headline text-xl">
                <PieChart className="h-5 w-5 text-primary" />
                Expenses by Category
              </CardTitle>
              <CardDescription>Main cost drivers</CardDescription>
            </div>
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

      <Card className="shadow-lg shadow-primary/5 border-primary/10">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <CardTitle className="font-headline">Recent Transactions</CardTitle>
                <CardDescription>Showing records from {date?.from ? format(date.from, "PPP") : "the beginning"}.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto shadow-sm">
                <Link href="/transactions">View Full Ledger</Link>
            </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    No transactions found for the selected dates.
                  </TableCell>
                </TableRow>
              ) : filteredTransactions.slice(0, 8).map((transaction) => (
                <TableRow key={transaction.id} className="hover:bg-primary/5 transition-colors">
                  <TableCell className="font-medium">
                    <div>{transaction.description}</div>
                    <div className="text-xs text-muted-foreground sm:hidden">{transaction.category} - {transaction.date}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="font-normal">{transaction.category}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{transaction.date}</TableCell>
                  <TableCell className="text-right">
                    <Badge 
                      variant={transaction.type === 'Income' ? 'default' : 'destructive'} 
                      className={cn(
                        "font-bold whitespace-nowrap shadow-sm border-none", 
                        transaction.type === 'Income' 
                          ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20' 
                          : 'bg-red-500/10 text-red-700 hover:bg-red-500/20'
                      )}
                    >
                      {transaction.type === 'Income' ? '+' : '-'}₦{transaction.amount.toLocaleString()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
