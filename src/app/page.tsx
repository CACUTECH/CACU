"use client"

import * as React from 'react';
import { AreaChart, BarChart3, DollarSign, Package, Users, Activity, PieChart, Calendar as CalendarIcon } from 'lucide-react';
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
import { format, addDays } from 'date-fns';
import { DateRange } from 'react-day-picker';

const chartConfig = {
  "Office Supplies": { color: "hsl(var(--chart-1))" },
  "Software": { color: "hsl(var(--chart-2))" },
  "Meals & Ent.": { color: "hsl(var(--chart-3))" },
  "Contractors": { color: "hsl(var(--chart-4))" },
  "Marketing": { color: "hsl(var(--chart-5))" },
  "Utilities": { color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;


export default function DashboardPage() {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(2024, 6, 1),
    to: new Date(2024, 6, 31),
  });

  const totalRevenue = transactions
    .filter((t) => t.type === 'Income')
    .reduce((acc, t) => acc + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === 'Expense')
    .reduce((acc, t) => acc + t.amount, 0);
  const netProfit = totalRevenue - totalExpenses;
  const totalCustomers = 54; // Placeholder

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, Jane. Here's what's happening with your business.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-full sm:w-[300px] justify-start text-left font-normal",
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline">₦{totalRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+20.1% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline">₦{totalExpenses.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+18.3% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline">₦{netProfit.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+19% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-headline">+{totalCustomers}</div>
            <p className="text-xs text-muted-foreground">+10 since last month</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-headline">
              <AreaChart className="h-5 w-5" />
              Income vs. Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataChart type="area" data={incomeVsExpenseData} curveType="monotone" config={{
              income: { label: "Income", color: "hsl(120 70% 50%)" },
              expense: { label: "Expense", color: "hsl(0 70% 50%)" },
            }} dataKeys={['income', 'expense']} index="month" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-headline">
              <PieChart className="h-5 w-5" />
              Expenses by Category
            </CardTitle>
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

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <CardTitle className="font-headline">Recent Transactions</CardTitle>
                <CardDescription>A log of the most recent financial activities.</CardDescription>
            </div>
            <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href="/transactions">View All</Link>
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
              {transactions.slice(0, 5).map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="font-medium">
                    <div>{transaction.description}</div>
                    <div className="text-xs text-muted-foreground sm:hidden">{transaction.category} - {transaction.date}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{transaction.category}</TableCell>
                  <TableCell className="hidden md:table-cell">{transaction.date}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={transaction.type === 'Income' ? 'default' : 'destructive'} className={cn("font-medium whitespace-nowrap", transaction.type === 'Income' ? 'bg-green-500/20 text-green-700 hover:bg-green-500/30' : 'bg-red-500/20 text-red-700 hover:bg-red-500/30')}>
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