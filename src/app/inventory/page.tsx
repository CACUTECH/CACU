"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { inventoryItems as allInventoryItems } from '@/lib/data';
import type { InventoryItem } from '@/lib/data';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
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

export default function InventoryPage() {
    const [inventoryItems, setInventoryItems] = React.useState<InventoryItem[]>(allInventoryItems);

    const getStatusBadgeVariant = (status: InventoryItem['status']) => {
        switch (status) {
            case 'In Stock': return 'default';
            case 'Low Stock': return 'secondary';
            case 'Out of Stock': return 'destructive';
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline">Inventory</CardTitle>
                        <CardDescription>Manage your product inventory.</CardDescription>
                    </div>
                    <Button>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product Name</TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead>Quantity</TableHead>
                                <TableHead>Price</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead><span className="sr-only">Actions</span></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {inventoryItems.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell>{item.sku}</TableCell>
                                    <TableCell>{item.quantity}</TableCell>
                                    <TableCell>${item.price.toLocaleString()}</TableCell>
                                    <TableCell>
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
                                                <DropdownMenuItem>Edit</DropdownMenuItem>
                                                <DropdownMenuItem>Record Sale</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive focus:text-destructive focus:bg-destructive/10">Delete</DropdownMenuItem>
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
    );
}
