"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlusCircle, Search, MoreHorizontal, Download, FileSpreadsheet } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type Account = {
    code: string;
    name: string;
    type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
    balance: number;
    status: 'Active' | 'Inactive';
}

const initialAccounts: Account[] = [
    { code: '1000', name: 'Cash and Bank', type: 'Asset', balance: 1240000, status: 'Active' },
    { code: '1200', name: 'Accounts Receivable', type: 'Asset', balance: 500000, status: 'Active' },
    { code: '1300', name: 'Inventory', type: 'Asset', balance: 850000, status: 'Active' },
    { code: '2000', name: 'Accounts Payable', type: 'Liability', balance: 350000, status: 'Active' },
    { code: '2200', name: 'Business Loan', type: 'Liability', balance: 5000000, status: 'Active' },
    { code: '3000', name: 'Share Capital', type: 'Equity', balance: 30000000, status: 'Active' },
    { code: '3200', name: 'Retained Earnings', type: 'Equity', balance: 1322500, status: 'Active' },
    { code: '4000', name: 'Sales Revenue', type: 'Income', balance: 1250000, status: 'Active' },
    { code: '5000', name: 'Office Supplies', type: 'Expense', balance: 15000, status: 'Active' },
    { code: '5100', name: 'Marketing', type: 'Expense', balance: 30000, status: 'Active' },
]

export default function ChartOfAccountsPage() {
    const [searchTerm, setSearchTerm] = React.useState("")
    const [accounts] = React.useState<Account[]>(initialAccounts)

    const filteredAccounts = accounts.filter(acc => 
        acc.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        acc.code.includes(searchTerm)
    )

    const getTypeColor = (type: Account['type']) => {
        switch(type) {
            case 'Asset': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
            case 'Liability': return 'bg-red-500/10 text-red-600 border-red-500/20';
            case 'Equity': return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
            case 'Income': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
            case 'Expense': return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
            default: return '';
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Chart of Accounts</h1>
                    <p className="text-muted-foreground mt-1">Organize your business finances with a structured ledger.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Export PDF
                    </Button>
                    <Button variant="outline" size="sm">
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Excel
                    </Button>
                    <Button size="sm">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Account
                    </Button>
                </div>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <CardTitle className="font-headline">Global Ledger</CardTitle>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search account name or code..." 
                                className="pl-9 rounded-xl border-primary/10" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-[100px]">Code</TableHead>
                                    <TableHead>Account Name</TableHead>
                                    <TableHead>Account Type</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead className="w-[50px]"><span className="sr-only">Actions</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredAccounts.map((account) => (
                                    <TableRow key={account.code} className="hover:bg-primary/5 transition-colors">
                                        <TableCell className="font-mono font-medium">{account.code}</TableCell>
                                        <TableCell className="font-bold">{account.name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", getTypeColor(account.type))}>
                                                {account.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-bold">
                                            ₦{account.balance.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 text-[10px]">
                                                {account.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="rounded-full">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="rounded-xl">
                                                    <DropdownMenuLabel>Account Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem>Edit Details</DropdownMenuItem>
                                                    <DropdownMenuItem>View Ledger</DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive">Deactivate</DropdownMenuItem>
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
    )
}
