"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, Calendar as CalendarIcon } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import React from 'react';
import { DateRange } from "react-day-picker"
import { addDays, format } from "date-fns"
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

interface ReportExportDropdownProps {
    reportId: string;
    reportTitle: string;
}

function ReportExportDropdown({ reportId, reportTitle }: ReportExportDropdownProps) {
    const handleExport = async (format: 'pdf' | 'excel') => {
        const table = document.getElementById(reportId);
        if (!table) return;

        const title = `${reportTitle} - ${new Date().toLocaleDateString()}`;

        if (format === 'pdf') {
            const { default: jsPDF } = await import('jspdf');
            const doc = new jsPDF();
            doc.text(title, 14, 15);
            (doc as any).autoTable({
                html: `#${reportId}`,
                startY: 20,
            });
            doc.save(`${reportTitle}.pdf`);
        } else if (format === 'excel') {
            const workbook = XLSX.utils.table_to_book(table);
            XLSX.writeFile(workbook, `${reportTitle}.xlsx`);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    Export
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('pdf')}>Export as PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('excel')}>Export as Excel</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function ProfitAndLossStatement({ dateRange }: { dateRange?: DateRange }) {
    const fromDate = dateRange?.from ? format(dateRange.from, "LLL dd, y") : "the start";
    const toDate = dateRange?.to ? format(dateRange.to, "LLL dd, y") : "today";

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <CardTitle>Profit & Loss Statement</CardTitle>
                    <CardDescription>For the period from {fromDate} to {toDate}</CardDescription>
                </div>
                 <ReportExportDropdown reportId="pnl-table" reportTitle="Profit and Loss Statement" />
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table id="pnl-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-full sm:w-[300px]">Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow className="font-bold">
                                <TableCell>Revenue</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Client Revenue</TableCell>
                                <TableCell className="text-right">₦12,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Total Revenue</TableCell>
                                <TableCell className="text-right">₦12,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold pt-4">
                                <TableCell>Expenses</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Office Supplies</TableCell>
                                <TableCell className="text-right">₦150.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Contractors</TableCell>
                                <TableCell className="text-right">₦1,200.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Software</TableCell>
                                <TableCell className="text-right">₦45.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Marketing</TableCell>
                                <TableCell className="text-right">₦300.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Total Expenses</TableCell>
                                <TableCell className="text-right">₦1,695.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold bg-card border-t-2">
                                <TableCell>Net Profit</TableCell>
                                <TableCell className="text-right text-green-500">₦10,805.00</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

function CashFlowStatement({ dateRange }: { dateRange?: DateRange }) {
    const fromDate = dateRange?.from ? format(dateRange.from, "LLL dd, y") : "the start";
    const toDate = dateRange?.to ? format(dateRange.to, "LLL dd, y") : "today";

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <CardTitle>Cash Flow Statement</CardTitle>
                    <CardDescription>For the period from {fromDate} to {toDate}</CardDescription>
                </div>
                <ReportExportDropdown reportId="cashflow-table" reportTitle="Cash Flow Statement" />
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table id="cashflow-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-full sm:w-[300px]">Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Operating Activities */}
                            <TableRow className="font-bold">
                                <TableCell>Cash flow from operating activities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Receipts from customers</TableCell>
                                <TableCell className="text-right">₦12,500.00</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Payments to suppliers and employees</TableCell>
                                <TableCell className="text-right">(₦1,350.00)</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Payments for other operating expenses</TableCell>
                                <TableCell className="text-right">(₦425.00)</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Net cash from operating activities</TableCell>
                                <TableCell className="text-right">₦10,725.00</TableCell>
                            </TableRow>

                            {/* Investing Activities */}
                             <TableRow className="font-bold pt-4">
                                <TableCell>Cash flow from investing activities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Purchase of equipment</TableCell>
                                <TableCell className="text-right">(₦2,000.00)</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Net cash used in investing activities</TableCell>
                                <TableCell className="text-right">(₦2,000.00)</TableCell>
                            </TableRow>

                            {/* Financing Activities */}
                             <TableRow className="font-bold pt-4">
                                <TableCell>Cash flow from financing activities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Proceeds from bank loan</TableCell>
                                <TableCell className="text-right">₦5,000.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell>Net cash from financing activities</TableCell>
                                <TableCell className="text-right">₦5,000.00</TableCell>
                            </TableRow>

                            {/* Summary */}
                             <TableRow className="font-bold bg-card border-t-2">
                                <TableCell>Net increase in cash and cash equivalents</TableCell>
                                <TableCell className="text-right text-green-500">₦13,725.00</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell>Cash and cash equivalents at beginning of period</TableCell>
                                <TableCell className="text-right">₦2,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold bg-card border-t">
                                <TableCell>Cash and cash equivalents at end of period</TableCell>
                                <TableCell className="text-right">₦16,225.00</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

function BalanceSheetStatement({ date }: { date?: Date }) {
    const asOfDate = date ? format(date, "LLL dd, y") : "today";
    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <CardTitle>Balance Sheet</CardTitle>
                    <CardDescription>As at {asOfDate}</CardDescription>
                </div>
                <ReportExportDropdown reportId="balancesheet-table" reportTitle="Balance Sheet" />
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table id="balancesheet-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-full sm:w-[300px]">Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Assets */}
                            <TableRow className="font-bold text-lg bg-muted/50">
                                <TableCell>Assets</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow className="font-bold">
                                <TableCell className="pl-4">Current Assets</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Cash and cash equivalents</TableCell>
                                <TableCell className="text-right">₦16,225.00</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Accounts receivable</TableCell>
                                <TableCell className="text-right">₦5,000.00</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Inventory</TableCell>
                                <TableCell className="text-right">₦8,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell className="pl-4">Total Current Assets</TableCell>
                                <TableCell className="text-right">₦29,725.00</TableCell>
                            </TableRow>
                             <TableRow className="font-bold">
                                <TableCell className="pl-4">Non-Current Assets</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Property, Plant, and Equipment</TableCell>
                                <TableCell className="text-right">₦22,000.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell className="pl-4">Total Non-Current Assets</TableCell>
                                <TableCell className="text-right">₦22,000.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold bg-card border-t-2 text-base">
                                <TableCell>Total Assets</TableCell>
                                <TableCell className="text-right">₦51,725.00</TableCell>
                            </TableRow>
                            
                            {/* Equity and Liabilities */}
                            <TableRow className="font-bold text-lg bg-muted/50 mt-4">
                                <TableCell>Equity and Liabilities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                             <TableRow className="font-bold">
                                <TableCell className="pl-4">Current Liabilities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Accounts payable</TableCell>
                                <TableCell className="text-right">₦3,500.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell className="pl-4">Total Current Liabilities</TableCell>
                                <TableCell className="text-right">₦3,500.00</TableCell>
                            </TableRow>
                             <TableRow className="font-bold">
                                <TableCell className="pl-4">Non-Current Liabilities</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell className="pl-8">Long-term debt</TableCell>
                                <TableCell className="text-right">₦5,000.00</TableCell>
                            </TableRow>
                             <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell className="pl-4">Total Non-Current Liabilities</TableCell>
                                <TableCell className="text-right">₦5,000.00</TableCell>
                            </TableRow>
                            <TableRow className="font-bold border-t-2 text-base">
                                <TableCell>Total Liabilities</TableCell>
                                <TableCell className="text-right">₦8,500.00</TableCell>
                            </TableRow>
                            
                             <TableRow className="font-bold">
                                <TableCell className="pl-4">Equity</TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Share Capital</TableCell>
                                <TableCell className="text-right">₦30,000.00</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell className="pl-8">Retained Earnings</TableCell>
                                <TableCell className="text-right">₦13,225.00</TableCell>
                            </TableRow>
                             <TableRow className="font-bold border-t bg-muted/20">
                                <TableCell className="pl-4">Total Equity</TableCell>
                                <TableCell className="text-right">₦43,225.00</TableCell>
                            </TableRow>

                             <TableRow className="font-bold bg-card border-t-2 text-base">
                                <TableCell>Total Equity and Liabilities</TableCell>
                                <TableCell className="text-right">₦51,725.00</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

function DatePickerWithRange({ className }: React.HTMLAttributes<HTMLDivElement>) {
    const [date, setDate] = React.useState<DateRange | undefined>({
      from: new Date(2024, 0, 20),
      to: addDays(new Date(2024, 0, 20), 20),
    })

    return (
        <div className={cn("grid gap-2", className)}>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                            "w-[300px] justify-start text-left font-normal",
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
                            <span>Pick a date</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
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
    )
}

export default function ReportsPage() {
    const [date, setDate] = React.useState<DateRange | undefined>({
        from: new Date(),
        to: addDays(new Date(), 7),
    });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h1 className="font-headline text-2xl font-bold">Financial Reports</h1>
                <div className="flex items-center gap-2">
                     <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                    "w-full sm:w-[260px] justify-start text-left font-normal",
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
            <Tabs defaultValue="pnl">
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 sm:w-auto h-auto p-1 bg-primary/5 border border-primary/10 shadow-xl shadow-primary/5 rounded-xl">
                    <TabsTrigger 
                        value="pnl" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-md transition-all"
                    >
                        Profit & Loss
                    </TabsTrigger>
                    <TabsTrigger 
                        value="cashflow" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md transition-all"
                    >
                        Cash Flow
                    </TabsTrigger>
                    <TabsTrigger 
                        value="balance-sheet" 
                        className="py-2.5 rounded-lg data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-md transition-all"
                    >
                        Balance Sheet
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="pnl" className="mt-4">
                    <ProfitAndLossStatement dateRange={date} />
                </TabsContent>
                <TabsContent value="cashflow" className="mt-4">
                    <CashFlowStatement dateRange={date} />
                </TabsContent>
                <TabsContent value="balance-sheet" className="mt-4">
                    <BalanceSheetStatement date={date?.to} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
