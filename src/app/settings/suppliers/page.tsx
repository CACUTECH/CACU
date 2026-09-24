
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Phone, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { saveSupplierAction, deleteSupplierAction } from "./actions";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Supplier = {
    id: string;
    name: string;
    contact_person: string;
    email: string;
    phone: string;
    category: string;
    lead_time: string;
    status: string;
}

export default function SuppliersSettingsPage() {
    const { user } = useSupabaseUser();
    const supabase = createClient();
    const { toast } = useToast();
    const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
    const [loading, setLoading] = React.useState(true);

    const fetchSuppliers = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('suppliers')
            .select('*')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'Sync Error', description: error.message });
        } else {
            setSuppliers(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchSuppliers();
    }, [user, fetchSuppliers]);

    const handleSave = async (data: Partial<Supplier>) => {
        const result = await saveSupplierAction(data);
        if (result.success) {
            toast({ title: "Supplier Saved" });
            fetchSuppliers();
        } else {
            toast({ variant: "destructive", title: "Error", description: result.error });
        }
    };

    const handleDelete = async (id: string) => {
        const result = await deleteSupplierAction(id);
        if (result.success) {
            toast({ title: "Supplier Removed" });
            fetchSuppliers();
        }
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Suppliers</h1>
                    <p className="text-muted-foreground">Manage your vendor directory and supply chain partners.</p>
                </div>
                <AddSupplierDialog onSave={handleSave} />
            </div>
            <Card className="shadow-xl border-primary/5">
                <CardHeader>
                    <CardTitle>Supplier Directory</CardTitle>
                    <CardDescription>All records are isolated to your business membership.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="pl-6">Supplier</TableHead>
                                    <TableHead>Contact</TableHead>
                                    <TableHead>Lead Time</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {suppliers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic">
                                            No suppliers registered yet.
                                        </TableCell>
                                    </TableRow>
                                ) : suppliers.map((s) => (
                                    <TableRow key={s.id} className="hover:bg-primary/5 transition-colors">
                                        <TableCell className="pl-6">
                                            <div className="font-bold">{s.name}</div>
                                            <div className="text-[10px] text-muted-foreground uppercase tracking-tighter">{s.category || 'General'}</div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm font-medium">{s.contact_person || 'N/A'}</div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Phone className="h-3 w-3" /> {s.phone}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">{s.lead_time || 'Immediate'}</TableCell>
                                        <TableCell className="text-right pr-6">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="rounded-full">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(s.id)}>
                                                        <Trash2 className="h-4 w-4 mr-2" /> Remove
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function AddSupplierDialog({ onSave }: { onSave: (data: Partial<Supplier>) => void }) {
    const [name, setName] = React.useState('');
    const [phone, setPhone] = React.useState('');

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button className="rounded-xl shadow-lg shadow-primary/20">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Supplier
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add New Vendor</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Supplier Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alaba Wholesale" />
                    </div>
                    <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234..." />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button onClick={() => { onSave({ name, phone }); setName(''); setPhone(''); }}>Add to Directory</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
