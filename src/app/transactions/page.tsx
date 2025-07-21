"use client"

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { transactions as allTransactions } from '@/lib/data';
import type { Transaction } from '@/lib/data';
import { Search, ListFilter } from 'lucide-react';
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

export default function TransactionsPage() {
    const [transactions, setTransactions] = React.useState<Transaction[]>(allTransactions);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline">Transactions</CardTitle>
                        <CardDescription>View and manage all your transactions.</CardDescription>
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <div className="relative w-full">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search transactions..." className="pl-8 w-full" />
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <ListFilter className="h-4 w-4" />
                                Filter
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem checked>Income</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem>Expense</DropdownMenuCheckboxItem>
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
                            <TableHead>Category</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {transactions.map((transaction) => (
                            <TableRow key={transaction.id}>
                                <TableCell className="font-medium">{transaction.description}</TableCell>
                                <TableCell>
                                    <Badge variant="outline">{transaction.category}</Badge>
                                </TableCell>
                                <TableCell>{transaction.account}</TableCell>
                                <TableCell>{transaction.date}</TableCell>
                                <TableCell className="text-right">
                                    <Badge variant={transaction.type === 'Income' ? 'default' : 'destructive'}>
                                        {transaction.type === 'Income' ? '+' : '-'}${transaction.amount.toLocaleString()}
                                    </Badge>
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
