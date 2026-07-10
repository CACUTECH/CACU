"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlusCircle, Search, MoreHorizontal, Download, FileSpreadsheet, Trash2, Edit2, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import * as XLSX from 'xlsx'
import { format } from "date-fns"

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
    const { toast } = useToast()
    const [searchTerm, setSearchTerm] = React.useState("")
    const [accounts, setAccounts] = React.useState<Account[]>(initialAccounts)
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [isEditOpen, setIsEditOpen] = React.useState(false)
    const [selectedAccount, setSelectedAccount] = React.useState<Account | null>(null)
    const [isExporting, setIsExporting] = React.useState(false)

    // Form State
    const [formData, setFormData] = React.useState<Partial<Account>>({
        code: '',
        name: '',
        type: 'Asset',
        balance: 0,
        status: 'Active'
    })

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

    const handleAddAccount = () => {
        if (!formData.code || !formData.name) {
            toast({ variant: "destructive", title: "Missing Fields", description: "Code and Name are required." })
            return
        }

        const newAccount: Account = {
            code: formData.code,
            name: formData.name,
            type: formData.type as any,
            balance: formData.balance || 0,
            status: 'Active'
        }

        setAccounts([...accounts, newAccount])
        setIsAddOpen(false)
        resetForm()
        toast({ title: "Account Created", description: `${newAccount.name} (${newAccount.code}) added to ledger.` })
    }

    const handleEditAccount = () => {
        if (!selectedAccount || !formData.name) return

        const updated = accounts.map(acc => 
            acc.code === selectedAccount.code ? { ...acc, ...formData } as Account : acc
        )

        setAccounts(updated)
        setIsEditOpen(false)
        setSelectedAccount(null)
        resetForm()
        toast({ title: "Account Updated", description: "Changes saved successfully." })
    }

    const handleDeleteAccount = (code: string) => {
        setAccounts(accounts.filter(acc => acc.code !== code))
        toast({ title: "Account Removed", description: "The account has been deleted from your ledger." })
    }

    const resetForm = () => {
        setFormData({ code: '', name: '', type: 'Asset', balance: 0, status: 'Active' })
    }

    const openEdit = (acc: Account) => {
        setSelectedAccount(acc)
        setFormData(acc)
        setIsEditOpen(true)
    }

    const exportToPdf = async () => {
        setIsExporting(true)
        try {
            const { default: jsPDF } = await import('jspdf')
            require('jspdf-autotable')
            const doc = new jsPDF()

            doc.setFontSize(20)
            doc.text("Chart of Accounts Report", 14, 22)
            
            doc.setFontSize(10)
            doc.text(`Generated on: ${format(new Date(), 'PPP')}`, 14, 30)
            doc.text("Business: CACU Technologies Limited", 14, 35)

            const tableRows = filteredAccounts.map(acc => [
                acc.code,
                acc.name,
                acc.type,
                `₦${acc.balance.toLocaleString()}`,
                acc.status
            ])

            ;(doc as any).autoTable({
                startY: 45,
                head: [['Code', 'Account Name', 'Type', 'Balance', 'Status']],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [82, 51, 255] }
            })

            doc.save(`Chart_of_Accounts_${format(new Date(), 'yyyyMMdd')}.pdf`)
            toast({ title: "PDF Exported", description: "Your report is ready." })
        } catch (error) {
            toast({ variant: "destructive", title: "Export Failed", description: "Could not generate PDF." })
        } finally {
            setIsExporting(false)
        }
    }

    const exportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(filteredAccounts.map(acc => ({
            'Account Code': acc.code,
            'Account Name': acc.name,
            'Type': acc.type,
            'Balance (NGN)': acc.balance,
            'Status': acc.status
        })))
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Chart of Accounts")
        XLSX.writeFile(workbook, `Chart_of_Accounts_${format(new Date(), 'yyyyMMdd')}.xlsx`)
        toast({ title: "Excel Exported", description: "Spreadsheet downloaded successfully." })
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Chart of Accounts</h1>
                    <p className="text-muted-foreground mt-1">Organize your business finances with a structured ledger.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportToPdf} disabled={isExporting}>
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Export PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToExcel}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Excel
                    </Button>
                    
                    <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(open) resetForm(); }}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="rounded-xl shadow-lg shadow-primary/20">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Account
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="font-headline text-xl">Create Ledger Account</DialogTitle>
                                <DialogDescription>Define a new account in your double-entry system.</DialogDescription>
                            </DialogHeader>
                            <AccountForm data={formData} setData={setFormData} />
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button onClick={handleAddAccount}>Create Account</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
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
                                {filteredAccounts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic">
                                            No accounts found matching your search.
                                        </TableCell>
                                    </TableRow>
                                ) : filteredAccounts.map((account) => (
                                    <TableRow key={account.code} className="hover:bg-primary/5 transition-colors group">
                                        <TableCell className="font-mono font-medium">{account.code}</TableCell>
                                        <TableCell className="font-bold group-hover:text-primary transition-colors">{account.name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", getTypeColor(account.type))}>
                                                {account.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-bold">
                                            ₦{account.balance.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="secondary" className={cn(
                                                "text-[10px]",
                                                account.status === 'Active' ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"
                                            )}>
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
                                                <DropdownMenuContent align="end" className="rounded-xl w-48">
                                                    <DropdownMenuLabel>Account Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => openEdit(account)}><Edit2 className="h-4 w-4 mr-2" /> Edit Details</DropdownMenuItem>
                                                    <DropdownMenuItem>View Ledger</DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem 
                                                        className="text-destructive" 
                                                        onClick={() => handleDeleteAccount(account.code)}
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" /> Deactivate
                                                    </DropdownMenuItem>
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

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-headline text-xl">Edit Account Details</DialogTitle>
                        <DialogDescription>Modify settings for {selectedAccount?.name}.</DialogDescription>
                    </DialogHeader>
                    <AccountForm data={formData} setData={setFormData} isEdit />
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={handleEditAccount}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function AccountForm({ data, setData, isEdit }: { data: Partial<Account>, setData: (d: any) => void, isEdit?: boolean }) {
    return (
        <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="code">Account Code</Label>
                    <Input 
                        id="code" 
                        placeholder="e.g. 1000" 
                        value={data.code} 
                        onChange={(e) => setData({ ...data, code: e.target.value })}
                        disabled={isEdit}
                        className="font-mono"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="type">Account Type</Label>
                    <Select 
                        value={data.type} 
                        onValueChange={(val: any) => setData({ ...data, type: val })}
                    >
                        <SelectTrigger id="type">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Asset">Asset</SelectItem>
                            <SelectItem value="Liability">Liability</SelectItem>
                            <SelectItem value="Equity">Equity</SelectItem>
                            <SelectItem value="Income">Income</SelectItem>
                            <SelectItem value="Expense">Expense</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="name">Account Name</Label>
                <Input 
                    id="name" 
                    placeholder="e.g. Petty Cash" 
                    value={data.name} 
                    onChange={(e) => setData({ ...data, name: e.target.value })}
                />
            </div>
            {!isEdit && (
                 <div className="space-y-2">
                    <Label htmlFor="balance">Opening Balance (₦)</Label>
                    <Input 
                        id="balance" 
                        type="number" 
                        placeholder="0" 
                        value={data.balance} 
                        onChange={(e) => setData({ ...data, balance: parseFloat(e.target.value) || 0 })}
                    />
                </div>
            )}
        </div>
    )
}
