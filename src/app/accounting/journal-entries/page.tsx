"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Calendar as CalendarIcon, Save, ArrowRightLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { format } from "date-fns"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"

import { useBusiness } from '@/components/business-provider'
import { PostedEntries } from '@/components/posted-entries'
import type { PostedEntry } from '@/lib/corrections'
import { getPostingAccountsAction, listJournalsAction, postJournalAction, reverseJournalAction } from './actions';

type JournalLine = {
    id: string;
    accountId: string;
    description: string;
    debit: number;
    credit: number;
}


export default function JournalEntriesPage() {
    const { toast } = useToast()
    const [accounts, setAccounts] = React.useState<{ id: string; name: string }[]>([])
    const [saving, setSaving] = React.useState(false)
    const requestKey = React.useRef<string | null>(null)
    const [date, setDate] = React.useState<Date | undefined>(new Date())
    const [memo, setMemo] = React.useState("")
    const [lines, setLines] = React.useState<JournalLine[]>([])
    const [mounted, setMounted] = React.useState(false)
    const { business } = useBusiness()
    const [journals, setJournals] = React.useState<{ native: boolean; journals: PostedEntry[] } | null>(null)
    const loadJournals = React.useCallback(async () => {
        const result = await listJournalsAction()
        if (result.success) setJournals(result.data)
    }, [])

    // Fix Hydration Mismatch by generating IDs only on client
    React.useEffect(() => {
        requestKey.current = crypto.randomUUID()
        void getPostingAccountsAction().then(setAccounts).catch(() => toast({ variant: 'destructive', title: 'Accounts unavailable' }))
        setMounted(true)
        void loadJournals()
        setLines([
            { id: crypto.randomUUID(), accountId: "", description: "", debit: 0, credit: 0 },
            { id: crypto.randomUUID(), accountId: "", description: "", debit: 0, credit: 0 },
        ])
    }, [toast, loadJournals])

    const addLine = () => {
        setLines([...lines, { id: crypto.randomUUID(), accountId: "", description: "", debit: 0, credit: 0 }])
    }

    const removeLine = (id: string) => {
        if (lines.length <= 2) return
        setLines(lines.filter(l => l.id !== id))
    }

    const updateLine = <K extends keyof JournalLine>(id: string, field: K, value: JournalLine[K]) => {
        setLines(lines.map(line => {
            if (line.id === id) {
                // When entering debit, clear credit and vice versa
                if (field === 'debit' && Number(value) > 0) return { ...line, [field]: value, credit: 0 }
                if (field === 'credit' && Number(value) > 0) return { ...line, [field]: value, debit: 0 }
                return { ...line, [field]: value }
            }
            return line
        }))
    }

    const totalDebit = lines.reduce((acc, curr) => acc + (Number(curr.debit) || 0), 0)
    const totalCredit = lines.reduce((acc, curr) => acc + (Number(curr.credit) || 0), 0)
    const isBalanced = totalDebit === totalCredit && totalDebit > 0

    const handleSave = async () => {
        if (!requestKey.current || !date || !isBalanced || !memo) return;
        setSaving(true);
        const result = await postJournalAction({ request_key: requestKey.current, date: format(date, 'yyyy-MM-dd'), memo,
            lines: lines.map(line => ({ account_id: line.accountId, description: line.description, debit: line.debit.toFixed(2), credit: line.credit.toFixed(2) })) });
        if (result.success) {
            toast({ title: 'Journal posted', description: 'The balanced entry and audit event were committed.' });
            requestKey.current = crypto.randomUUID(); setMemo(''); setLines([]); void loadJournals();
        } else toast({ variant: 'destructive', title: 'Posting failed', description: result.error });
        setSaving(false);
    }

    if (!mounted) return null

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Journal Adjustments</h1>
                <p className="text-muted-foreground mt-1">Manual ledger entries for corrections, payroll, or depreciation.</p>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader className="bg-primary/5 border-b">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Transaction Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal bg-background", !date && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>General Memo / Reference</Label>
                            <Input placeholder="e.g. Year-end tax adjustment" value={memo} onChange={(e) => setMemo(e.target.value)} className="bg-background" />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-[250px]">Account</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="w-[150px] text-right">Debit (₦)</TableHead>
                                    <TableHead className="w-[150px] text-right">Credit (₦)</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lines.map((line) => (
                                    <TableRow key={line.id} className="group">
                                        <TableCell>
                                            <Select value={line.accountId} onValueChange={(val) => updateLine(line.id, 'accountId', val)}>
                                                <SelectTrigger className="bg-background border-none shadow-none focus:ring-1">
                                                    <SelectValue placeholder="Select account..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {accounts.map(acc => (
                                                        <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.id})</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                placeholder="Line description" 
                                                className="border-none shadow-none focus-visible:ring-1" 
                                                value={line.description}
                                                onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="text-right border-none shadow-none focus-visible:ring-1 font-mono" 
                                                value={line.debit || ""}
                                                onChange={(e) => updateLine(line.id, 'debit', parseFloat(e.target.value))}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="text-right border-none shadow-none focus-visible:ring-1 font-mono" 
                                                value={line.credit || ""}
                                                onChange={(e) => updateLine(line.id, 'credit', parseFloat(e.target.value))}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-opacity"
                                                onClick={() => removeLine(line.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <Button variant="outline" className="mt-4 rounded-xl border-dashed" onClick={addLine}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add New Line
                    </Button>
                </CardContent>
                <CardFooter className="bg-muted/30 border-t flex flex-col md:flex-row items-center justify-between gap-6 p-6">
                    <div className="flex items-center gap-8 w-full md:w-auto">
                        <div className="text-sm">
                            <p className="text-muted-foreground uppercase font-bold text-[10px] tracking-widest mb-1">Total Debit</p>
                            <p className="text-xl font-bold font-headline">₦{totalDebit.toLocaleString()}</p>
                        </div>
                        <div className="text-sm">
                            <p className="text-muted-foreground uppercase font-bold text-[10px] tracking-widest mb-1">Total Credit</p>
                            <p className="text-xl font-bold font-headline">₦{totalCredit.toLocaleString()}</p>
                        </div>
                        <div className="h-10 w-px bg-border hidden md:block" />
                        <div className="text-sm">
                            <p className="text-muted-foreground uppercase font-bold text-[10px] tracking-widest mb-1">Difference</p>
                            <p className={cn("text-xl font-bold font-headline", totalDebit - totalCredit === 0 ? "text-emerald-500" : "text-red-500")}>
                                ₦{Math.abs(totalDebit - totalCredit).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        {!isBalanced && totalDebit > 0 && (
                             <div className="text-xs font-bold text-red-500 flex items-center gap-1 uppercase tracking-tighter">
                                <ArrowRightLeft className="h-3 w-3" /> Entry Out of Balance
                             </div>
                        )}
                        <Button className="w-full md:w-48 h-12 rounded-xl shadow-lg shadow-primary/20" disabled={!isBalanced || saving || !memo || lines.some(line => !line.accountId)} onClick={handleSave}>
                            <Save className="mr-2 h-4 w-4" />
                            Post Adjustment
                        </Button>
                    </div>
                </CardFooter>
            </Card>
            {journals?.native && <PostedEntries title="Posted journals" entries={journals.journals} canReverse={['owner', 'admin'].includes(business?.userRole ?? '')}
                empty="No manual journals posted yet." onReverse={reverseJournalAction} onReversed={() => void loadJournals()} />}
        </div>
    )
}
