
"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, MoreHorizontal, Loader2, Package, AlertTriangle, TrendingUp } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { saveCatalogItemAction, deleteCatalogItemAction } from '../catalog/actions';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type CatalogItem = {
    id: string;
    type: 'Product' | 'Service';
    name: string;
    sku?: string;
    quantity?: number;
    price: number;
    reorder_level?: number;
    status: string;
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
            .select('*, type:item_type, price:unit_price, quantity:stock_quantity')
            .eq('item_type', 'Product')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'Inventory Error', description: error.message });
        } else {
            setItems(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchItems();
    }, [user, fetchItems]);

    const lowStockCount = items.filter(i => (i.quantity || 0) <= (i.reorder_level || 0)).length;

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Inventory Intelligence</h1>
                    <p className="text-muted-foreground mt-1">Real-time stock tracking and replenishment alerts.</p>
                </div>
                <Button asChild className="rounded-xl shadow-lg shadow-primary/20">
                    <Link href="/catalog">
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Product
                    </Link>
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <InventoryStatCard title="Total SKUs" value={items.length.toString()} icon={Package} />
                <InventoryStatCard title="Low Stock Alerts" value={lowStockCount.toString()} icon={AlertTriangle} variant={lowStockCount > 0 ? 'warning' : 'default'} />
                <InventoryStatCard title="Asset Value" value={`₦${items.reduce((acc, i) => acc + (i.price * (i.quantity || 0)), 0).toLocaleString()}`} icon={TrendingUp} />
            </div>

            <Card className="shadow-xl border-primary/5">
                <CardHeader>
                    <CardTitle className="font-headline">Stock Ledger</CardTitle>
                    <CardDescription>Live physical inventory levels for your retail operations.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Product Name</TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead className="text-center">Stock Level</TableHead>
                                <TableHead className="text-right">Unit Price</TableHead>
                                <TableHead className="text-center">Status</TableHead>
                                <TableHead className="text-right pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic">No products found in catalog.</TableCell></TableRow>
                            ) : items.map((item) => {
                                const isLow = (item.quantity || 0) <= (item.reorder_level || 0);
                                return (
                                    <TableRow key={item.id} className="hover:bg-primary/5 transition-colors">
                                        <TableCell className="pl-6 font-bold">{item.name}</TableCell>
                                        <TableCell className="font-mono text-xs">{item.sku || '--'}</TableCell>
                                        <TableCell className="text-center">
                                            <div className={cn("font-bold text-sm", isLow ? "text-red-600" : "")}>
                                                {item.quantity}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground uppercase">Threshold: {item.reorder_level}</div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">₦{Number(item.price).toLocaleString()}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={isLow ? 'destructive' : 'default'} className="text-[10px] uppercase">
                                                {isLow ? 'Restock Required' : 'Healthy'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem asChild><Link href="/catalog">Update Catalog</Link></DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function InventoryStatCard({ title, value, icon: Icon, variant = 'default' }: any) {
    return (
        <Card className={cn(
            "bg-primary/5 border-primary/10",
            variant === 'warning' && "bg-amber-500/10 border-amber-500/20"
        )}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
            </CardContent>
        </Card>
    )
}
