"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { transactions as allTransactions } from '@/lib/data';
import type { Transaction } from '@/lib/data';
import { Search, ListFilter, PlusCircle, Upload } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

function AddTransactionDialog() {
    const [date, setDate] = React.useState<Date>()
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button className="w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Transaction
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                <DialogTitle>Add Transaction</DialogTitle>
                <DialogDescription>
                    Record a new income or expense. Click save when you're done.
                </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">
                        Description
                        </Label>
                        <Input id="description" placeholder="e.g. Office supplies" className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">
                        Amount
                        </Label>
                        <Input id="amount" type="number" placeholder="e.g. 150.00" className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                         <Label htmlFor="type" className="text-right">
                        Type
                        </Label>
                        <Select>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="income">Income</SelectItem>
                                <SelectItem value="expense">Expense</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                         <Label htmlFor="category" className="text-right">
                        Category
                        </Label>
                        <Select>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="client">Client Revenue</SelectItem>
                                <SelectItem value="supplies">Office Supplies</SelectItem>
                                <SelectItem value="software">Software</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="date" className="text-right">
                            Date
                        </Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal col-span-3",
                                    !date && "text-muted-foreground"
                                )}
                                >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={setDate}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" className="w-full">Save changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function TransactionsPage() {
    const [transactions, setTransactions] = React.useState<Transaction[]>(allTransactions);
    const { toast } = useToast();
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);
                
                // Assuming the excel file has columns that match the Transaction type
                console.log(json);

                // Here you would typically validate and transform the data
                // and then update the state
                // For now, we'll just show a success toast
                toast({
                    title: "File Uploaded",
                    description: `${file.name} has been processed. Check the console for the data.`,
                });
            } catch (error) {
                 toast({
                    variant: "destructive",
                    title: "Upload Failed",
                    description: `Could not parse the file ${file.name}.`,
                });
                console.error("Error parsing file:", error);
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline">Transactions</CardTitle>
                        <CardDescription>View and manage all your financial transactions.</CardDescription>
                    </div>
                     <div className="flex flex-col sm:flex-row items-center gap-2">
                        <Input
                            type="file"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                        />
                        <Button variant="outline" className="w-full sm:w-auto" onClick={handleImportClick}>
                            <Upload className="mr-2 h-4 w-4" />
                            Import
                        </Button>
                        <AddTransactionDialog />
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <div className="relative w-full">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search transactions..." className="pl-8 w-full" />
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="gap-2 shrink-0">
                                <ListFilter className="h-4 w-4" />
                                <span className="hidden sm:inline">Filter</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem checked>Income</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem>Expense</DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="hidden sm:table-cell">Category</TableHead>
                            <TableHead className="hidden md:table-cell">Account</TableHead>
                            <TableHead className="hidden lg:table-cell">Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {transactions.map((transaction) => (
                            <TableRow key={transaction.id}>
                                <TableCell className="font-medium">
                                    <div className="truncate">{transaction.description}</div>
                                    <div className="text-xs text-muted-foreground lg:hidden">
                                        <span>{transaction.date}</span>
                                        <span className="md:hidden"> - {transaction.account}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                    <Badge variant="outline">{transaction.category}</Badge>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">{transaction.account}</TableCell>
                                <TableCell className="hidden lg:table-cell">{transaction.date}</TableCell>
                                <TableCell className="text-right">
                                    <Badge variant={transaction.type === 'Income' ? 'default' : 'destructive'} className={cn("font-medium whitespace-nowrap", transaction.type === 'Income' ? 'bg-green-500/20 text-green-700 hover:bg-green-500/30' : 'bg-red-500/20 text-red-700 hover:bg-red-500/30')}>
                                        {transaction.type === 'Income' ? '+' : '-'}₦{transaction.amount.toLocaleString()}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>
            </CardContent>
        </Card>
    );
}
