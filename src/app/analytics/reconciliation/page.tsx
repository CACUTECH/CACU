"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, AlertCircle, Landmark, ArrowRightLeft, FileSearch, Search, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const bankTransactions = [
    { id: 'b1', date: '2024-07-20', desc: 'Transfer from Alice Johnson', amount: 250000, type: 'Credit', matched: true },
    { id: 'b2', date: '2024-07-19', desc: 'POS Purchase: Office Depot', amount: -15000, type: 'Debit', matched: true },
    { id: 'b3', date: '2024-07-18', desc: 'Bank Maintenance Fee', amount: -250, type: 'Debit', matched: false },
    { id: 'b4', date: '2024-07-17', desc: 'Transfer from Bob Williams', amount: 120000, type: 'Credit', matched: false },
]

const bookTransactions = [
    { id: 'bk1', date: '2024-07-20', desc: 'INV-001: Alice Johnson', amount: 250000, type: 'Income', matched: true },
    { id: 'bk2', date: '2024-07-19', desc: 'Stationery - Office Depot', amount: -15000, type: 'Expense', matched: true },
    { id: 'bk3', date: '2024-07-17', desc: 'INV-002: Bob Williams', amount: 120000, type: 'Income', matched: false },
]

export default function ReconciliationPage() {
    const { toast } = useToast()
    const [selectedBank, setSelectedBank] = React.useState("sterling")

    const handleAutoReconcile = () => {
        toast({
            title: "Auto-reconciliation started",
            description: "We are matching 4 new transactions based on amount and date.",
        })
    }

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Accounts Reconciliation</h1>
                    <p className="text-muted-foreground mt-1">
                        Sync your linked bank statements with your internal business records.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Statement
                    </Button>
                    <Button size="sm" onClick={handleAutoReconcile}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                        Run Auto-Match
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-1">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Landmark className="h-4 w-4 text-primary" />
                            Active Account
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Select value={selectedBank} onValueChange={setSelectedBank}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="sterling">Sterling Bank (...5678)</SelectItem>
                                <SelectItem value="access">Access Bank (...1234)</SelectItem>
                                <SelectItem value="paga">Paga Business Wallet</SelectItem>
                            </SelectContent>
                        </Select>
                        <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Bank Balance</span>
                                <span className="font-bold">₦1,240,000</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Book Balance</span>
                                <span className="font-bold">₦1,120,250</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <FileSearch className="h-4 w-4 text-primary" />
                            Reconciliation Progress
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="text-2xl font-bold font-headline">82%</div>
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                                12 Matched
                            </Badge>
                        </div>
                        <Progress value={82} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                            3 transactions require manual review to complete this month's records.
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
                {/* Bank Side */}
                <Card className="border-primary/10">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center justify-between">
                            Bank Statement
                            <Badge variant="secondary">Sterling Bank</Badge>
                        </CardTitle>
                        <CardDescription>Recent records fetched from your bank API.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Date / Description</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {bankTransactions.map((tx) => (
                                        <TableRow key={tx.id} className="group">
                                            <TableCell>
                                                <div className="font-medium text-xs">{tx.date}</div>
                                                <div className="text-sm truncate max-w-[150px]">{tx.desc}</div>
                                            </TableCell>
                                            <TableCell className={cn("text-right font-mono font-medium", tx.amount > 0 ? "text-emerald-600" : "text-foreground")}>
                                                ₦{Math.abs(tx.amount).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {tx.matched ? (
                                                    <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto" />
                                                ) : (
                                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-primary hover:bg-primary/10">
                                                        Match
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                {/* Internal Side */}
                <Card className="border-primary/10">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center justify-between">
                            Internal Books
                            <Badge variant="secondary">CACU Records</Badge>
                        </CardTitle>
                        <CardDescription>Transactions recorded in your CACU ledger.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Date / Description</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {bookTransactions.map((tx) => (
                                        <TableRow key={tx.id}>
                                            <TableCell>
                                                <div className="font-medium text-xs">{tx.date}</div>
                                                <div className="text-sm truncate max-w-[150px]">{tx.desc}</div>
                                            </TableCell>
                                            <TableCell className={cn("text-right font-mono font-medium", tx.type === 'Income' ? "text-emerald-600" : "text-foreground")}>
                                                ₦{Math.abs(tx.amount).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {tx.matched ? (
                                                    <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto" />
                                                ) : (
                                                    <AlertCircle className="h-5 w-5 text-amber-500 mx-auto" />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    <TableRow className="bg-muted/10 border-dashed">
                                        <TableCell colSpan={3} className="text-center py-6">
                                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                <Search className="h-8 w-8 opacity-20" />
                                                <p className="text-xs">No match found for ₦120,000 entry yet.</p>
                                                <Button variant="link" size="sm" className="h-auto p-0">Search manually</Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
