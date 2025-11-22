"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { inventoryItems as allInventoryItems } from '@/lib/data';
import type { InventoryItem } from '@/lib/data';
import { PlusCircle, MoreHorizontal, Upload, X } from 'lucide-react';
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
import * as XLSX from 'xlsx';

function getStatus(quantity: number, reorderLevel: number): InventoryItem['status'] {
    if (quantity === 0) return 'Out of Stock';
    if (quantity <= reorderLevel) return 'Low Stock';
    return 'In Stock';
}

function AddProductDialog({ onSave }: { onSave: (newProduct: InventoryItem) => void }) {
    const [name, setName] = React.useState('');
    const [sku, setSku] = React.useState('');
    const [quantity, setQuantity] = React.useState('0');
    const [price, setPrice] = React.useState('0');
    const [reorderLevel, setReorderLevel] = React.useState('10');
    const [isOpen, setIsOpen] = React.useState(false);

    const handleSave = () => {
        const numQuantity = parseInt(quantity, 10);
        const numPrice = parseFloat(price);
        const numReorderLevel = parseInt(reorderLevel, 10);

        if (name && sku && !isNaN(numQuantity) && !isNaN(numPrice) && !isNaN(numReorderLevel)) {
            const newProduct: InventoryItem = {
                id: `prod-${Date.now()}`,
                name,
                sku,
                quantity: numQuantity,
                price: numPrice,
                reorderLevel: numReorderLevel,
                status: getStatus(numQuantity, numReorderLevel),
            };
            onSave(newProduct);
            setIsOpen(false);
            // Reset form
            setName('');
            setSku('');
            setQuantity('0');
            setPrice('0');
            setReorderLevel('10');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Product
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add New Product</DialogTitle>
                    <DialogDescription>
                        Enter the details of the new product.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="col-span-3" placeholder="e.g. Premium Widget" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sku" className="text-right">SKU</Label>
                        <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} className="col-span-3" placeholder="e.g. PW-001" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="quantity" className="text-right">Quantity</Label>
                        <Input id="quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="col-span-3" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="price" className="text-right">Price (₦)</Label>
                        <Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="col-span-3" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="reorderLevel" className="text-right">Reorder Level</Label>
                        <Input id="reorderLevel" type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="col-span-3" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" onClick={handleSave}>Save Product</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function EditProductDialog({ item, onSave, onOpenChange, open }: { item: InventoryItem | null; onSave: (updatedProduct: InventoryItem) => void; onOpenChange: (open: boolean) => void, open: boolean }) {
    const [name, setName] = React.useState('');
    const [sku, setSku] = React.useState('');
    const [quantity, setQuantity] = React.useState('0');
    const [price, setPrice] = React.useState('0');
    const [reorderLevel, setReorderLevel] = React.useState('10');

    React.useEffect(() => {
        if(item) {
            setName(item.name);
            setSku(item.sku);
            setQuantity(String(item.quantity));
            setPrice(String(item.price));
            setReorderLevel(String(item.reorderLevel));
        }
    }, [item]);

    const handleSave = () => {
        if (!item) return;

        const numQuantity = parseInt(quantity, 10);
        const numPrice = parseFloat(price);
        const numReorderLevel = parseInt(reorderLevel, 10);

        if (name && sku && !isNaN(numQuantity) && !isNaN(numPrice) && !isNaN(numReorderLevel)) {
            const updatedProduct: InventoryItem = {
                ...item,
                name,
                sku,
                quantity: numQuantity,
                price: numPrice,
                reorderLevel: numReorderLevel,
                status: getStatus(numQuantity, numReorderLevel),
            };
            onSave(updatedProduct);
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Product</DialogTitle>
                    <DialogDescription>
                        Update the details of {item?.name}.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-name" className="text-right">Name</Label>
                        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-sku" className="text-right">SKU</Label>
                        <Input id="edit-sku" value={sku} onChange={(e) => setSku(e.target.value)} className="col-span-3" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-quantity" className="text-right">Quantity</Label>
                        <Input id="edit-quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="col-span-3" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-price" className="text-right">Price (₦)</Label>
                        <Input id="edit-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="col-span-3" />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-reorderLevel" className="text-right">Reorder Level</Label>
                        <Input id="edit-reorderLevel" type="number" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="col-span-3" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="submit" onClick={handleSave}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function RecordSaleDialog({ item, onRecordSale, open, onOpenChange }: { item: InventoryItem | null; onRecordSale: (itemId: string, quantitySold: number) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [quantity, setQuantity] = React.useState('1');
    const { toast } = useToast();

    const handleRecord = () => {
        if (!item) return;

        const soldQuantity = parseInt(quantity, 10);
        if (isNaN(soldQuantity) || soldQuantity <= 0) {
            toast({ variant: 'destructive', title: "Invalid Quantity", description: "Please enter a valid quantity." });
            return;
        }
        if (soldQuantity > item.quantity) {
            toast({ variant: 'destructive', title: "Insufficient Stock", description: `Only ${item.quantity} units available.` });
            return;
        }

        onRecordSale(item.id, soldQuantity);
        toast({ title: "Sale Recorded", description: `${soldQuantity} units of ${item.name} sold.` });
        onOpenChange(false);
        setQuantity('1');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Record Sale</DialogTitle>
                    <DialogDescription>Record a sale for {item?.name}. Current stock: {item?.quantity}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sale-quantity" className="text-right">Quantity Sold</Label>
                        <Input id="sale-quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="col-span-3" min="1" max={item?.quantity} />
                    </div>
                </div>
                <DialogFooter>
                     <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleRecord}>Record Sale</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function InventoryPage() {
    const [inventoryItems, setInventoryItems] = React.useState<InventoryItem[]>(allInventoryItems);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    
    const [editingItem, setEditingItem] = React.useState<InventoryItem | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
    
    const [sellingItem, setSellingItem] = React.useState<InventoryItem | null>(null);
    const [isSaleDialogOpen, setIsSaleDialogOpen] = React.useState(false);

    const getStatusBadgeVariant = (status: InventoryItem['status']) => {
        switch (status) {
            case 'In Stock': return 'default';
            case 'Low Stock': return 'secondary';
            case 'Out of Stock': return 'destructive';
        }
    };
    
    const handleAddProduct = (newProduct: InventoryItem) => {
        setInventoryItems(prev => [newProduct, ...prev]);
    };

    const handleEditProduct = (updatedProduct: InventoryItem) => {
        setInventoryItems(prev => prev.map(item => item.id === updatedProduct.id ? updatedProduct : item));
    }
    
    const openEditDialog = (item: InventoryItem) => {
        setEditingItem(item);
        setIsEditDialogOpen(true);
    };

    const openSaleDialog = (item: InventoryItem) => {
        setSellingItem(item);
        setIsSaleDialogOpen(true);
    }
    
    const handleRecordSale = (itemId: string, quantitySold: number) => {
        setInventoryItems(prev => prev.map(item => {
            if (item.id === itemId) {
                const newQuantity = item.quantity - quantitySold;
                return { ...item, quantity: newQuantity, status: getStatus(newQuantity, item.reorderLevel) };
            }
            return item;
        }));
    };

    const handleReorder = (item: InventoryItem) => {
        toast({
            title: "Reorder Initiated",
            description: `A reorder request for ${item.name} has been created.`,
        })
    }

    const handleDelete = (itemId: string) => {
        setInventoryItems(prev => prev.filter(item => item.id !== itemId));
        toast({
            title: "Product Deleted",
            description: "The product has been removed from your inventory.",
        })
    };


    const handleBulkUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            // Placeholder for bulk upload logic
            toast({
                title: "File Selected",
                description: `${file.name} is ready for upload. (Functionality to process the file is not yet implemented.)`,
            });
             // Reset file input
            if(fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    return (
        <>
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline">Inventory</CardTitle>
                        <CardDescription>Manage your product inventory and stock levels.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                         <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileChange}
                            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                        />
                        <Button variant="outline" onClick={handleBulkUploadClick}>
                            <Upload className="mr-2 h-4 w-4" />
                            Bulk Upload
                        </Button>
                        <AddProductDialog onSave={handleAddProduct} />
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
                            {inventoryItems.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell>{item.sku}</TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">₦{item.price.toLocaleString()}</TableCell>
                                    <TableCell className="text-center">
                                        <Badge variant={getStatusBadgeVariant(item.status)}>{item.status}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => openEditDialog(item)}>Edit</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => openSaleDialog(item)}>Record Sale</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleReorder(item)}>Reorder</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <DropdownMenuItem 
                                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                            onSelect={(e) => e.preventDefault()}
                                                        >
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This action cannot be undone. This will permanently delete the product
                                                            and remove its data from our servers.
                                                        </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDelete(item.id)}>Continue</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
        <EditProductDialog item={editingItem} onSave={handleEditProduct} open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} />
        <RecordSaleDialog item={sellingItem} onRecordSale={handleRecordSale} open={isSaleDialogOpen} onOpenChange={setIsSaleDialogOpen} />
        </>
    );
}
