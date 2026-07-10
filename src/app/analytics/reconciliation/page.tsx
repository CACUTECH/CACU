"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, AlertCircle, Landmark, ArrowRightLeft, FileSearch, Search, Upload, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

const initialBankTransactions = [
    { id: 'b1', date: '2024-07-20', desc: 'Transfer from Alice Johnson', amount: 250000, type: 'Credit', matched: true, bookId: 'bk1' },
    { id: 'b2', date: '2024-07-19', desc: 'POS Purchase: Office Depot', amount: -15000, type: 'Debit', matched: true, bookId: 'bk2' },
    { id: 'b3', date: '2024-07-18', desc: 'Bank Maintenance Fee', amount: -250, type: 'Debit', matched: false },
    { id: 'b4', date: '2024-07-17', desc: 'Transfer from Bob Williams', amount: 120000, type: 'Credit', matched: false },
]

const initialBookTransactions = [
    { id: 'bk1', date: '2024-07-20', desc: 'INV-001: Alice Johnson', amount: 250000, type: 'Income', matched: true, bankId: 'b1' },
    { id: 'bk2', date: '2024-07-19', desc: 'Stationery - Office Depot', amount: -15000, type: 'Expense', matched: true, bankId: 'b2' },
    { id: 'bk3', date: '2024-07-17', desc: 'INV-002: Bob Williams', amount: 120000, type: 'Income', matched: false },
]

export default function ReconciliationPage() {
    const { toast } = useToast()
    const [selectedBank, setSelectedBank] = React.useState("sterling")
    const [bankTx, setBankTx] = React.useState(initialBankTransactions)
    const [bookTx, setBookTx] = React.useState(initialBookTransactions)
    const [isReconciling, setIsReconciling] = React.useState(false)
    const fileInputRef = React.useRef<HTMLInputElement>(null)

    const matchedCount = bankTx.filter(t => t.matched).length
    const totalBankTx = bankTx.length
    const progress = Math.round((matchedCount / totalBankTx) * 100)

    const handleAutoReconcile = () => {
        setIsReconciling(true)
        
        setTimeout(() => {
            let foundCount = 0
            const newBankTx = [...bankTx]
            const newBookTx = [...bookTx]

            newBankTx.forEach(bankItem => {
                if (!bankTx.find(t => t.id === bankItem.id)?.matched) {
                    const match = newBookTx.find(bookItem => 
                        !bookItem.matched && 
                        Math.abs(bookItem.amount) === Math.abs(bankItem.amount)
                    )

                    if (match) {
                        const bIdx = newBankTx.findIndex(t => t.id === bankItem.id)
                        const bkIdx = newBookTx.findIndex(t => t.id === match.id)
                        
                        newBankTx[bIdx] = { ...newBankTx[bIdx], matched: true, bookId: match.id }
                        newBookTx[bkIdx] = { ...newBookTx[bkIdx], matched: true, bankId: bankItem.id }
                        foundCount++
                    }
                }
            })

            setBankTx(newBankTx)
            setBookTx(newBookTx)
            setIsReconciling(false)

            toast({
                title: foundCount > 0 ? "Auto-Match Complete" : "No Matches Found",
                description: foundCount > 0 
                    ? `Successfully paired ${foundCount} transactions based on value and date.` 
                    : "We couldn't find any clear matches. Manual review required.",
            })
        }, 1500)
    }

    const handleManualMatch = (bankId: string) => {
        const item = bankTx.find(t => t.id === bankId)
        if (!item) return

        // Simplified logic for manual match: find same amount or just toggle if it's a known gap
        const potentialBookMatch = bookTx.find(t => !t.matched && Math.abs(t.amount) === Math.abs(item.amount))

        if (potentialBookMatch) {
            setBankTx(prev => prev.map(t => t.id === bankId ? { ...t, matched: true, bookId: potentialBookMatch.id } : t))
            setBookTx(prev => prev.map(t => t.id === potentialBookMatch.id ? { ...t, matched: true, bankId } : t))
            toast({ title: "Transaction Matched", description: "Entry reconciled with internal records." })
        } else {
            // For items like "Bank Maintenance Fee" which might not be in books yet
            toast({
                title: "No Internal Record Found",
                description: `You need to record a matching ${item.amount < 0 ? 'expense' : 'income'} of ₦${Math.abs(item.amount).toLocaleString()} in your books first.`,
                variant: "destructive"
            })
        }
    }

    const handleUploadClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            toast({
                title: "Statement Uploaded",
                description: `Successfully imported ${file.name}. Analyzing entries...`,
            })
        }
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
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        onChange={handleFileChange}
                        accept=".csv, .pdf"
                    />
                    <Button variant="outline" size="sm" onClick={handleUploadClick}>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Statement
                    </Button>
                    <Button size="sm" onClick={handleAutoReconcile} disabled={isReconciling}>
                        {isReconciling ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <ArrowRightLeft className="mr-2 h-4 w-4" />
                        )}
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
                            <div className="text-2xl font-bold font-headline">{progress}%</div>
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                                {matchedCount} Matched
                            </Badge>
                        </div>
                        <Progress value={progress} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                            {totalBankTx - matchedCount === 0 
                                ? "Perfect balance! All entries accounted for." 
                                : `${totalBankTx - matchedCount} transactions require manual review to complete this month's records.`}
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
                            <Badge variant="secondary">
                                {selectedBank === 'sterling' ? 'Sterling Bank' : selectedBank === 'access' ? 'Access Bank' : 'Paga'}
                            </Badge>
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
                                    {bankTx.map((tx) => (
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
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm" 
                                                        className="h-8 px-2 text-xs text-primary hover:bg-primary/10"
                                                        onClick={() => handleManualMatch(tx.id)}
                                                    >
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
                                    {bookTx.map((tx) => (
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
                                    {bookTx.every(t => t.matched) && (
                                         <TableRow className="bg-muted/10 border-dashed">
                                            <TableCell colSpan={3} className="text-center py-6">
                                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                    <CheckCircle2 className="h-8 w-8 text-emerald-500 opacity-20" />
                                                    <p className="text-xs">All internal records matched!</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {!bookTx.every(t => t.matched) && (
                                        <TableRow className="bg-muted/10 border-dashed">
                                            <TableCell colSpan={3} className="text-center py-6">
                                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                    <Search className="h-8 w-8 opacity-20" />
                                                    <p className="text-xs">Searching for matching ledger entries...</p>
                                                    <Button variant="link" size="sm" className="h-auto p-0">Search manually</Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
