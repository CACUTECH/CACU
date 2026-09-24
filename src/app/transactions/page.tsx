
"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, PlusCircle, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { recordLedgerEntryAction } from './actions';

type Transaction = {
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'Income' | 'Expense';
    category: string;
    business_id: string;
}

export default function TransactionsPage() {
    const { user } = useSupabaseUser();
    const supabase = createClient();
    const { toast } = useToast();
    const [transactions, setTransactions] = React.useState<Transaction[]>([]);
    const [loading, setLoading] = React.useState(true);

    const [formData, setFormData] = React.useState<Partial<Transaction>>({
        description: '',
        amount: 0,
        type: 'Income',
        category: 'Services'
    })

    const fetchTX = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('financial_transactions')
            .select('*')
            .order('date', { ascending: false });
        
        if (error) {
            toast({ variant: 'destructive', title: 'Ledger Error', description: error.message });
        } else {
            setTransactions(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchTX();
    }, [user, fetchTX]);

    const handleAddTransaction = async () => {
        const result = await recordLedgerEntryAction(formData);
        if (!result.success) {
            toast({ variant: 'destructive', title: 'Post Failed', description: result.error });
        } else {
            toast({ title: "Transaction Posted" });
            fetchTX();
            setFormData({ description: '', amount: 0, type: 'Income', category: 'Services' });
        }
    }

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Financial Ledger</h1>
                    <p className="text-muted-foreground text-sm">Strict multi-tenant records managed by LedgerService.</p>
                </div>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button><PlusCircle className="mr-2 h-4 w-4" /> Record Entry</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Manual Journal Entry</DialogTitle></DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2"><Label>Description</Label><Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2"><Label>Amount (₦)</Label><Input type="number" value={formData.amount} onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})} /></div>
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={formData.type} onValueChange={(val: any) => setFormData({...formData, type: val})}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Income">Income (+)</SelectItem>
                                            <SelectItem value="Expense">Expense (-)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button onClick={handleAddTransaction}>Post to Ledger</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="shadow-xl border-primary/5">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Description</TableHead>
                                <TableHead>Category</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right pr-6">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transactions.map((tx) => (
                                <TableRow key={tx.id} className="hover:bg-primary/5 transition-colors">
                                    <TableCell className="pl-6">
                                        <div className="flex items-center gap-2">
                                            {tx.type === 'Income' ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                                            <span className="font-bold">{tx.description}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-tighter">{tx.category}</Badge></TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{tx.date}</TableCell>
                                    <TableCell className="text-right pr-6 font-mono font-bold">
                                        <span className={tx.type === 'Income' ? 'text-emerald-600' : 'text-red-600'}>
                                            {tx.type === 'Income' ? '+' : '-'}₦{Number(tx.amount).toLocaleString()}
                                        </span>
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
