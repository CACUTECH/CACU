"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, MoreHorizontal, Upload, Loader2 } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from '@/hooks/use-toast';
import { collection, doc, setDoc, deleteDoc, query, orderBy, limit } from 'firebase/firestore';
import { useFirestore, useUser, useCollection, useDoc } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type CatalogItem = {
    id: string;
    type: 'Product' | 'Service';
    name: string;
    sku?: string;
    category: string;
    description: string;
    quantity?: number;
    price: number;
    reorderLevel?: number;
    status: string;
}

function getStatus(quantity: number, reorderLevel: number): string {
    if (quantity === 0) return 'Out of Stock';
    if (quantity <= reorderLevel) return 'Low Stock';
    return 'In Stock';
}

export default function InventoryPage() {
    const { user } = useUser();
    const db = useFirestore();
    const { toast } = useToast();
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Context Loading
    const businessId = user?.uid;
    const itemsRef = businessId ? collection(db, 'businesses', businessId, 'catalog') : null;
    
    // P2 FIX: Implement strict limits to prevent DoW read spikes
    const itemsQuery = itemsRef ? query(itemsRef, orderBy('name'), limit(50)) : null;
    const { data: inventoryItems, loading } = useCollection<CatalogItem>(itemsQuery);

    const [editingItem, setEditingItem] = React.useState<CatalogItem | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

    const handleSaveItem = (item: Partial<CatalogItem>) => {
        if (!businessId || !itemsRef) return;
        
        const id = item.id || `prod-${Date.now()}`;
        const docRef = doc(itemsRef, id);
        const data = { ...item, id };

        setDoc(docRef, data, { merge: true })
            .then(() => {
                toast({ title: item.id ? "Product Updated" : "Product Added" });
            })
            .catch(async (e) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: 'write',
                    requestResourceData: data,
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    };

    const handleDelete = (itemId: string) => {
        if (!businessId || !itemsRef) return;
        const docRef = doc(itemsRef, itemId);
        
        deleteDoc(docRef)
            .then(() => toast({ title: "Product Removed" }))
            .catch(async (e) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: 'delete',
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <CardTitle className="font-headline">Inventory</CardTitle>
                            <CardDescription>Manage your product inventory and stock levels in the cloud.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                <Upload className="mr-2 h-4 w-4" /> Bulk Upload
                            </Button>
                            <AddProductDialog onSave={handleSaveItem} />
                        </div>
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
                                    <TableHead><span className="sr-only">Actions</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {inventoryItems?.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell className="text-center">{item.quantity}</TableCell>
                                        <TableCell className="text-right">₦{item.price.toLocaleString()}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={item.status === 'In Stock' ? 'default' : 'secondary'}>{item.status}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex justify-end">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => { setEditingItem(item); setIsEditDialogOpen(true); }}>Edit</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()}>Delete</DropdownMenuItem>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                    <AlertDialogDescription>This action will permanently delete this product from the database.</AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDelete(item.id)}>Delete</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {inventoryItems?.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                            Your inventory is empty. Add your first product to get started.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
            
            <EditProductDialog 
                item={editingItem} 
                open={isEditDialogOpen} 
                onOpenChange={setIsEditDialogOpen} 
                onSave={handleSaveItem} 
            />
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx" />
        </div>
    );
}

function AddProductDialog({ onSave }: { onSave: (item: Partial<CatalogItem>) => void }) {
    const [name, setName] = React.useState('');
    const [sku, setSku] = React.useState('');
    const [quantity, setQuantity] = React.useState('0');
    const [price, setPrice] = React.useState('0');
    const [reorderLevel, setReorderLevel] = React.useState('10');
    const [isOpen, setIsOpen] = React.useState(false);

    const handleSave = () => {
        const q = parseInt(quantity);
        const rl = parseInt(reorderLevel);
        onSave({
            type: 'Product',
            name,
            sku,
            category: 'General',
            description: '',
            quantity: q,
            price: parseFloat(price),
            reorderLevel: rl,
            status: getStatus(q, rl)
        });
        setIsOpen(false);
        setName(''); setSku(''); setQuantity('0'); setPrice('0');
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Add Product</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} /></div>
                        <div className="space-y-2"><Label>Price (₦)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                        <div className="space-y-2"><Label>Reorder Level</Label><Input type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} /></div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={!name}>Save Product</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function EditProductDialog({ item, open, onOpenChange, onSave }: { item: CatalogItem | null, open: boolean, onOpenChange: (o: boolean) => void, onSave: (i: Partial<CatalogItem>) => void }) {
    const [name, setName] = React.useState('');
    const [quantity, setQuantity] = React.useState('0');
    const [price, setPrice] = React.useState('0');

    React.useEffect(() => {
        if (item) {
            setName(item.name);
            setQuantity(item.quantity?.toString() || '0');
            setPrice(item.price.toString());
        }
    }, [item]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader><DialogTitle>Edit {item?.name}</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                        <div className="space-y-2"><Label>Price (₦)</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={() => {
                        onSave({ ...item, name, quantity: parseInt(quantity), price: parseFloat(price) });
                        onOpenChange(false);
                    }}>Update Item</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}