
"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, MoreHorizontal, Loader2 } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { saveCatalogItemAction, deleteCatalogItemAction } from './actions';

type CatalogItem = {
    id: string;
    type: 'Product' | 'Service';
    name: string;
    sku?: string;
    category: string;
    description: string;
    quantity?: number;
    price: number;
    reorder_level?: number;
    status: string;
    business_id: string;
}

export default function InventoryPage() {
    const { user } = useSupabaseUser();
    const supabase = createClient();
    const { toast } = useToast();
    const [items, setItems] = React.useState<CatalogItem[]>([]);
    const [loading, setLoading] = React.useState(true);

    const fetchItems = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('catalog_items')
            .select('*')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'Fetch Failed', description: error.message });
        } else {
            setItems(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchItems();
    }, [user, fetchItems]);

    const handleSaveItem = async (item: Partial<CatalogItem>) => {
        const result = await saveCatalogItemAction(item);
        if (!result.success) {
            toast({ variant: 'destructive', title: 'Save Failed', description: result.error });
        } else {
            toast({ title: 'Success', description: 'Catalog item updated.' });
            fetchItems();
        }
    };

    const handleDelete = async (id: string) => {
        const result = await deleteCatalogItemAction(id);
        if (!result.success) {
            toast({ variant: 'destructive', title: 'Delete Failed', description: result.error });
        } else {
            toast({ title: 'Removed', description: 'Item deleted from catalog.' });
            fetchItems();
        }
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <CardTitle className="font-headline text-2xl">Inventory & Catalog</CardTitle>
                            <CardDescription>Secure relational data managed via Backend Services.</CardDescription>
                        </div>
                        <AddProductDialog onSave={handleSaveItem} />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product Name</TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead className="text-center">Quantity</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell className="text-center">{item.quantity || '--'}</TableCell>
                                        <TableCell className="text-right">₦{Number(item.price).toLocaleString()}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={item.status === 'Active' ? 'default' : 'secondary'}>{item.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-destructive">Delete</DropdownMenuItem>
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

function AddProductDialog({ onSave }: { onSave: (item: Partial<CatalogItem>) => void }) {
    const [name, setName] = React.useState('');
    const [price, setPrice] = React.useState('0');

    return (
        <Dialog>
            <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Add Item</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>New Catalog Entry</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2"><Label>Item Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Price (₦)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button onClick={() => onSave({ name, price: parseFloat(price), type: 'Product', status: 'Active' })}>Post via Service</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
