
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Phone } from 'lucide-react';

const suppliers = [
    { name: "Alaba Mega Wholesale", contact: "+234 801 111 2222", leadTime: "3 days", items: 45 },
    { name: "Mainland Logistics", contact: "+234 802 333 4444", leadTime: "1 day", items: 12 },
    { name: "Green Agro-Tech", contact: "+234 803 555 6666", leadTime: "5 days", items: 8 },
];

export default function SuppliersSettingsPage() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h1 className="font-headline text-3xl font-bold">Suppliers</h1>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Supplier
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Supplier Directory</CardTitle>
                    <CardDescription>Manage supplier contacts and supply chain reliability.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Supplier</TableHead>
                                    <TableHead>Lead Time</TableHead>
                                    <TableHead>Catalog Size</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {suppliers.map((s) => (
                                    <TableRow key={s.name}>
                                        <TableCell>
                                            <div className="font-medium">{s.name}</div>
                                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Phone className="h-3 w-3" /> {s.contact}
                                            </div>
                                        </TableCell>
                                        <TableCell>{s.leadTime}</TableCell>
                                        <TableCell>{s.items} items</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm">Manage</Button>
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
