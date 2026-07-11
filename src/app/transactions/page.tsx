"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { transactions as initialTransactions } from '@/lib/data';
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
  DialogClose,
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

export default function TransactionsPage() {
    const { toast } = useToast();
    const [transactions, setTransactions] = React.useState<Transaction[]>(initialTransactions);
    const [searchTerm, setSearchTerm] = React.useState("");
    const [selectedTypes, setSelectedTypes] = React.useState<string[]>(["Income", "Expense"]);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Form State for Add Transaction
    const [date, setDate] = React.useState<Date | undefined>(new Date())
    const [formData, setFormData] = React.useState<Partial<Transaction>>({
        description: '',
        amount: 0,
        type: 'Income',
        category: 'Services',
        account: 'Business Checking'
    })

    const filteredTransactions = React.useMemo(() => {
        return transactions.filter((t) => {
            const matchesSearch = 
                t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.account.toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchesType = selectedTypes.includes(t.type);
            
            return matchesSearch && matchesType;
        });
    }, [searchTerm, selectedTypes, transactions]);

    const handleAddTransaction = () => {
        if (!formData.description || !formData.amount) return

        const newTx: Transaction = {
            id: `tx-${Date.now()}`,
            date: date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
            description: formData.description,
            amount: Number(formData.amount),
            type: formData.type as any,
            category: formData.category || 'General',
            account: formData.account || 'Business Checking'
        }

        setTransactions([newTx, ...transactions])
        setFormData({ description: '', amount: 0, type: 'Income', category: 'Services', account: 'Business Checking' })
        toast({ title: "Transaction Recorded", description: `${newTx.description} saved to ledger.` })
    }

    const toggleType = (type: string) => {
        setSelectedTypes(prev => 
            prev.includes(type) 
                ? prev.filter(t => t !== type) 
                : [...prev, type]
        );
    }

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                if (data instanceof ArrayBuffer) {
                    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet);
                    
                    toast({
                        title: "File Uploaded",
                        description: `${file.name} has been processed successfully.`,
                    });
                }
            } catch (error) {
                 toast({
                    variant: "destructive",
                    title: "Upload Failed",
                    description: `Could not parse the file ${file.name}.`,
                });
            }
        };
        reader.readAsArrayBuffer(file);
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
                                    Record a new income or expense.
                                </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Description</Label>
                                        <Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="e.g. Office supplies" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Amount (₦)</Label>
                                            <Input type="number" value={formData.amount} onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Type</Label>
                                            <Select value={formData.type} onValueChange={(val: any) => setFormData({...formData, type: val})}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Income">Income</SelectItem>
                                                    <SelectItem value="Expense">Expense</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Category</Label>
                                        <Input value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} placeholder="e.g. Marketing" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Date</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="w-full justify-start text-left font-normal">
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                                    <DialogClose asChild><Button onClick={handleAddTransaction}>Record Transaction</Button></DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <div className="relative w-full">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Search transactions..." 
                            className="pl-8 w-full" 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
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
                            <DropdownMenuCheckboxItem 
                                checked={selectedTypes.includes("Income")}
                                onCheckedChange={() => toggleType("Income")}
                            >
                                Income
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem 
                                checked={selectedTypes.includes("Expense")}
                                onCheckedChange={() => toggleType("Expense")}
                            >
                                Expense
                            </DropdownMenuCheckboxItem>
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
                        {filteredTransactions.map((transaction) => (
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
                        {filteredTransactions.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No transactions found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                </div>
            </CardContent>
        </Card>
    );
}
