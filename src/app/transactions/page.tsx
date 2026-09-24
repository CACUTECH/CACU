"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, ListFilter, PlusCircle, Upload, Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { collection, doc, setDoc, query, orderBy, limit } from 'firebase/firestore';
import { useFirestore, useUser, useCollection } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type Transaction = {
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'Income' | 'Expense';
    category: string;
    account: string;
}

export default function TransactionsPage() {
    const { user } = useUser();
    const db = useFirestore();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = React.useState("");
    const [selectedTypes, setSelectedTypes] = React.useState<string[]>(["Income", "Expense"]);

    // Context Loading
    const businessId = user?.uid;
    const txRef = businessId ? collection(db, 'businesses', businessId, 'transactions') : null;
    const txQuery = txRef ? query(txRef, orderBy('date', 'desc'), limit(100)) : null;
    const { data: transactions, loading } = useCollection<Transaction>(txQuery);

    const [date, setDate] = React.useState<Date | undefined>(new Date())
    const [formData, setFormData] = React.useState<Partial<Transaction>>({
        description: '',
        amount: 0,
        type: 'Income',
        category: 'Services',
        account: 'Business Checking'
    })

    const filteredTransactions = React.useMemo(() => {
        if (!transactions) return [];
        return transactions.filter((t) => {
            const matchesSearch = 
                t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.category.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = selectedTypes.includes(t.type);
            return matchesSearch && matchesType;
        });
    }, [searchTerm, selectedTypes, transactions]);

    const handleAddTransaction = () => {
        if (!businessId || !txRef || !formData.description || !formData.amount) return;

        const id = `tx-${Date.now()}`;
        const docRef = doc(txRef, id);
        const data = {
            id,
            date: date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
            description: formData.description,
            amount: Number(formData.amount),
            type: formData.type as any,
            category: formData.category || 'General',
            account: formData.account || 'Business Checking'
        };

        setDoc(docRef, data)
            .then(() => {
                toast({ title: "Transaction Recorded" });
                setFormData({ description: '', amount: 0, type: 'Income', category: 'Services', account: 'Business Checking' });
            })
            .catch(async (e) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: 'create',
                    requestResourceData: data,
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    }

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline">Transactions</CardTitle>
                        <CardDescription>Live cloud ledger for your organization.</CardDescription>
                    </div>
                     <div className="flex flex-col sm:flex-row items-center gap-2">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="w-full sm:w-auto">
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Add Transaction
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="space-y-2"><Label>Description</Label><Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} /></div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2"><Label>Amount (₦)</Label><Input type="number" value={formData.amount} onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})} /></div>
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
                                    <div className="space-y-2"><Label>Date</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="w-full justify-start text-left"><CalendarIcon className="mr-2 h-4 w-4" />{date ? format(date, "PPP") : 'Pick a date'}</Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={setDate} initialFocus /></PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button onClick={handleAddTransaction}>Record Transaction</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead className="hidden sm:table-cell">Category</TableHead>
                                <TableHead className="hidden lg:table-cell">Date</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTransactions.map((tx) => (
                                <TableRow key={tx.id}>
                                    <TableCell className="font-medium">{tx.description}</TableCell>
                                    <TableCell className="hidden sm:table-cell"><Badge variant="outline">{tx.category}</Badge></TableCell>
                                    <TableCell className="hidden lg:table-cell">{tx.date}</TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant={tx.type === 'Income' ? 'default' : 'destructive'}>
                                            {tx.type === 'Income' ? '+' : '-'}₦{tx.amount.toLocaleString()}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filteredTransactions.length === 0 && (
                                <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No transactions found.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}