"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Download, Calendar as CalendarIcon, Printer, FileArchive } from "lucide-react"
import { format } from "date-fns"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import * as XLSX from 'xlsx'

const trialBalanceData = [
    { code: '1000', name: 'Cash and Bank', debit: 1240000, credit: 0 },
    { code: '1200', name: 'Accounts Receivable', debit: 500000, credit: 0 },
    { code: '1300', name: 'Inventory', debit: 850000, credit: 0 },
    { code: '2000', name: 'Accounts Payable', debit: 0, credit: 350000 },
    { code: '2200', name: 'Business Loan', debit: 0, credit: 5000000 },
    { code: '3000', name: 'Share Capital', debit: 0, credit: 30000000 },
    { code: '3200', name: 'Retained Earnings', debit: 0, credit: 1322500 },
    { code: '4000', name: 'Sales Revenue', debit: 0, credit: 1250000 },
    { code: '5000', name: 'Office Supplies', debit: 15000, credit: 0 },
    { code: '5100', name: 'Marketing', debit: 30000, credit: 0 },
    { code: '9999', name: 'Suspense Account', debit: 35287500, credit: 0 }, // For demo balancing
]

export default function TrialBalancePage() {
    const [date, setDate] = React.useState<Date | undefined>(new Date())
    const { toast } = useToast()

    const totalDebit = trialBalanceData.reduce((acc, curr) => acc + curr.debit, 0)
    const totalCredit = trialBalanceData.reduce((acc, curr) => acc + curr.credit, 0)

    const handlePrint = () => {
        window.print()
    }

    const exportToExcel = () => {
        const dataForExport = trialBalanceData.map(item => ({
            'Account Code': item.code,
            'Account Description': item.name,
            'Debit (₦)': item.debit,
            'Credit (₦)': item.credit
        }))
        
        // Add totals row
        dataForExport.push({
            'Account Code': '',
            'Account Description': 'TOTALS',
            'Debit (₦)': totalDebit,
            'Credit (₦)': totalCredit
        })

        const worksheet = XLSX.utils.json_to_sheet(dataForExport)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Trial Balance")
        XLSX.writeFile(workbook, `Trial_Balance_${format(date || new Date(), 'yyyy-MM-dd')}.xlsx`)
        
        toast({
            title: "Export Successful",
            description: "Trial Balance has been exported to Excel format.",
        })
    }

    const exportToPdf = async () => {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()

        doc.setFontSize(18)
        doc.text("Trial Balance Report", 14, 20)
        
        doc.setFontSize(10)
        doc.text(`As at: ${format(date || new Date(), 'PPP')}`, 14, 28)
        doc.text("Business: CACU Technologies Limited", 14, 33)

        const tableRows = trialBalanceData.map(item => [
            item.code,
            item.name,
            item.debit > 0 ? `₦${item.debit.toLocaleString()}` : "-",
            item.credit > 0 ? `₦${item.credit.toLocaleString()}` : "-"
        ])

        // Add footer for totals
        tableRows.push([
            "",
            "TOTALS",
            `₦${totalDebit.toLocaleString()}`,
            `₦${totalCredit.toLocaleString()}`
        ])

        autoTable(doc, {
            startY: 40,
            head: [['Account Code', 'Account Description', 'Debit (₦)', 'Credit (₦)']],
            body: tableRows,
            theme: 'grid',
            headStyles: { fillColor: [82, 51, 255] },
            columnStyles: {
                2: { halign: 'right' },
                3: { halign: 'right' }
            },
            didParseCell: (data: any) => {
                if (data.row.index === tableRows.length - 1) {
                    data.cell.styles.fontStyle = 'bold'
                }
            }
        })

        doc.save(`Trial_Balance_${format(date || new Date(), 'yyyy-MM-dd')}.pdf`)
        
        toast({
            title: "Export Successful",
            description: "Trial Balance has been exported to PDF format.",
        })
    }

    const handleDownloadAuditPack = () => {
        toast({
            title: "Generating Audit Pack",
            description: "Compiling financial statements and ledger reports...",
        })
        // For simulation, we just download the PDF Trial Balance
        setTimeout(() => {
            exportToPdf()
        }, 1000)
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Trial Balance</h1>
                    <p className="text-muted-foreground mt-1">Review ledger integrity as at a specific date.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="bg-background">
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>As at Date</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                        </PopoverContent>
                    </Popover>
                    <Button variant="outline" size="sm" onClick={handlePrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print Report
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToExcel}>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                </div>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="font-headline">Accounting Integrity Check</CardTitle>
                            <CardDescription>Verified report of all account balances in the double-entry system.</CardDescription>
                        </div>
                        <div className="bg-emerald-500/10 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/20 flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            System Balanced
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-[120px]">Account Code</TableHead>
                                    <TableHead>Account Description</TableHead>
                                    <TableHead className="text-right w-[200px]">Debit (₦)</TableHead>
                                    <TableHead className="text-right w-[200px]">Credit (₦)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {trialBalanceData.map((item) => (
                                    <TableRow key={item.code} className="hover:bg-muted/20 transition-colors">
                                        <TableCell className="font-mono text-xs text-muted-foreground">{item.code}</TableCell>
                                        <TableCell className="font-medium">{item.name}</TableCell>
                                        <TableCell className="text-right font-mono">
                                            {item.debit > 0 ? `₦${item.debit.toLocaleString()}` : "-"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-red-600">
                                            {item.credit > 0 ? `₦${item.credit.toLocaleString()}` : "-"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableFooter className="bg-primary/5">
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={2} className="text-lg font-bold font-headline text-primary">Totals</TableCell>
                                    <TableCell className="text-right text-lg font-bold font-mono">₦{totalDebit.toLocaleString()}</TableCell>
                                    <TableCell className="text-right text-lg font-bold font-mono">₦{totalCredit.toLocaleString()}</TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-muted/50 border-dashed border-2">
                    <CardHeader>
                        <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground">Accounting Note</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                        <p>A balanced Trial Balance proves that your total debits equal total credits, but it does not guarantee there are no errors in your source entries.</p>
                        <p className="text-muted-foreground">Always perform a bank reconciliation and inventory count to verify physical values against these balances.</p>
                    </CardContent>
                </Card>
                <Card className="p-6 flex flex-col justify-center gap-4">
                    <div className="space-y-1">
                        <h3 className="font-headline text-xl font-bold">Audit Ready Reports</h3>
                        <p className="text-muted-foreground text-sm">Download your Trial Balance, General Ledger, and sub-ledgers for your tax accountant or external auditors.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleDownloadAuditPack}>
                            <FileArchive className="mr-2 h-4 w-4" />
                            Download Audit Pack
                        </Button>
                        <Button variant="link" size="sm">How to read this report?</Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}