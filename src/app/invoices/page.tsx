
"use client"

import * as React from "react"
import {
  MoreHorizontal,
  PlusCircle,
  File,
  X,
  Plus,
  Calendar as CalendarIcon,
  Download,
  Printer,
  UserPlus,
  ArrowRightLeft,
  RotateCcw,
  CheckCircle2,
  FileText,
  History,
  Loader2,
} from "lucide-react"
import type jsPDF from "jspdf"
import "jspdf-autotable"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { createInvoiceAction, markAsPaidAction, updateInvoiceStatusAction } from "./actions"

type Customer = {
    id: string;
    name: string;
}

type CatalogItem = {
    id: string;
    name: string;
    price: number;
}

type LineItem = {
    id: string;
    item: string;
    quantity: number;
    price: number;
    total: number;
}

type InvoiceType = "Invoice" | "Receipt" | "Estimate" | "CreditMemo";

type Invoice = {
    id: string;
    invoice_number: string;
    type: InvoiceType;
    status: "Paid" | "Pending" | "Unpaid" | "Accepted" | "Refunded" | "Draft" | "Cancelled";
    total: number;
    subtotal: number;
    tax: number;
    customer_id?: string;
    customer_name?: string;
    date: string;
    due_date?: string;
    notes?: string;
    vat_included: boolean;
}

const downloadPdf = async (invoice: Invoice) => {
    const { default: jsPDF } = await import('jspdf');
    require('jspdf-autotable');
    const doc = new jsPDF();
    const typeLabel = invoice.type === 'CreditMemo' ? 'Credit Memo' : invoice.type;

    doc.setFontSize(22);
    doc.text(`${typeLabel} #${invoice.invoice_number}`, 14, 22);

    doc.setFontSize(10);
    doc.text(`Date: ${invoice.date}`, 14, 32);
    if(invoice.due_date) doc.text(`Due Date: ${invoice.due_date}`, 14, 38);
    doc.text(`Customer: ${invoice.customer_name || 'N/A'}`, 14, 48);

    doc.setFontSize(12);
    doc.text(`Subtotal: ₦${invoice.subtotal.toLocaleString()}`, 14, 70);
    doc.text(`Tax: ₦${invoice.tax.toLocaleString()}`, 14, 77);
    doc.setFontSize(14);
    doc.text(`Total: ₦${invoice.total.toLocaleString()}`, 14, 87);

    doc.save(`${invoice.type}_${invoice.invoice_number}.pdf`);
};

export default function InvoicesPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [docs, setDocs] = React.useState<Invoice[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [activeTab, setActiveTab] = React.useState("invoices");
  const [loading, setLoading] = React.useState(true);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    const [invRes, custRes, itemRes] = await Promise.all([
        supabase.from('invoices').select('*, customers(name)').order('created_at', { ascending: false }),
        supabase.from('customers').select('id, name').order('name'),
        supabase.from('catalog_items').select('id, name, price').order('name')
    ]);

    if (!invRes.error) {
        setDocs(invRes.data.map(d => ({
            ...d,
            customer_name: d.customers?.name
        })));
    }
    if (!custRes.error) setCustomers(custRes.data);
    if (!itemRes.error) setItems(itemRes.data);
    setLoading(false);
  }, [supabase]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (action: string, inv: Invoice) => {
    if (action === 'pay') {
        const res = await markAsPaidAction({
            invoiceId: inv.id,
            customerId: inv.customer_id,
            amount: inv.total,
            method: 'Cash'
        });
        if (res.success) {
            toast({ title: "Payment Recorded" });
            fetchData();
        }
    } else if (action === 'convert') {
        const res = await updateInvoiceStatusAction(inv.id, 'Accepted');
        if (res.success) {
            toast({ title: "Estimate Accepted" });
            fetchData();
        }
    }
  };

  const filteredDocs = docs.filter(d => {
    if (activeTab === 'invoices') return d.type === 'Invoice';
    if (activeTab === 'receipts') return d.type === 'Receipt';
    if (activeTab === 'estimates') return d.type === 'Estimate';
    if (activeTab === 'refunds') return d.type === 'CreditMemo';
    return false;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 className="font-headline text-3xl font-bold">Billing & Receivables</h1>
                <p className="text-muted-foreground">Manage quotes, invoices, receipts, and customer credits.</p>
            </div>
            <div className="flex items-center gap-2">
                <CreateDocumentDialog 
                    type={activeTab === 'estimates' ? 'Estimate' : activeTab === 'refunds' ? 'CreditMemo' : activeTab === 'receipts' ? 'Receipt' : 'Invoice'} 
                    onSave={fetchData} 
                    customers={customers} 
                    catalogItems={items}
                />
            </div>
        </div>

        <Tabs defaultValue="invoices" onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full lg:w-max h-auto p-1 bg-primary/5 border border-primary/10 rounded-xl">
                <TabsTrigger value="invoices" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white">Invoices</TabsTrigger>
                <TabsTrigger value="estimates" className="rounded-lg data-[state=active]:bg-amber-600 data-[state=active]:text-white">Quotes / Estimates</TabsTrigger>
                <TabsTrigger value="receipts" className="rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white">Receipts</TabsTrigger>
                <TabsTrigger value="refunds" className="rounded-lg data-[state=active]:bg-red-600 data-[state=active]:text-white">Refunds / Credits</TabsTrigger>
            </TabsList>

            <div className="mt-6">
                 <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Customer</TableHead>
                                <TableHead>No.</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredDocs.map((inv) => (
                                <TableRow key={inv.id}>
                                    <TableCell className="font-medium">{inv.customer_name || 'Individual'}</TableCell>
                                    <TableCell className="text-xs font-mono">{inv.invoice_number}</TableCell>
                                    <TableCell>
                                        <Badge variant={
                                            inv.status === "Paid" || inv.status === "Accepted" ? "default" :
                                            inv.status === "Pending" ? "secondary" : "destructive"
                                        } className={cn(
                                            inv.status === "Paid" && "bg-emerald-500/10 text-emerald-700",
                                            inv.status === "Accepted" && "bg-blue-500/10 text-blue-700",
                                        )}>
                                            {inv.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs">{inv.date}</TableCell>
                                    <TableCell className="text-right font-bold">₦{inv.total.toLocaleString()}</TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => downloadPdf(inv)}>Download PDF</DropdownMenuItem>
                                                {inv.type === 'Estimate' && inv.status !== 'Accepted' && (
                                                    <DropdownMenuItem onClick={() => handleAction('convert', inv)} className="text-primary"><CheckCircle2 className="mr-2 h-4 w-4" /> Accept Quote</DropdownMenuItem>
                                                )}
                                                {inv.type === 'Invoice' && inv.status !== 'Paid' && (
                                                    <DropdownMenuItem onClick={() => handleAction('pay', inv)}>Mark as Paid</DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive">Cancel Document</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-primary/5 border-primary/10">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" /> Unbilled Estimates
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold font-headline">
                        ₦{docs.filter(d => d.type === 'Estimate' && d.status === 'Pending').reduce((acc, d) => acc + d.total, 0).toLocaleString()}
                    </div>
                </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/10">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <History className="h-4 w-4 text-primary" /> Outstanding A/R
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold font-headline">
                        ₦{docs.filter(d => d.type === 'Invoice' && d.status !== 'Paid').reduce((acc, d) => acc + d.total, 0).toLocaleString()}
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
  )
}

function CreateDocumentDialog({ 
    type, 
    onSave, 
    customers,
    catalogItems
}: { 
    type: InvoiceType; 
    onSave: () => void; 
    customers: Customer[]; 
    catalogItems: CatalogItem[];
}) {
    const [customer, setCustomer] = React.useState('');
    const [date, setDate] = React.useState<Date | undefined>(new Date());
    const [dueDate, setDueDate] = React.useState<Date | undefined>();
    const [lineItems, setLineItems] = React.useState<LineItem[]>([
        { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }
    ]);
    const [notes, setNotes] = React.useState('');
    const [includeVat, setIncludeVat] = React.useState(true);
    const [isOpen, setIsOpen] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);

    const subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
    const tax = includeVat ? subtotal * 0.075 : 0;
    const total = subtotal + tax;

    const handleSave = async () => {
        setIsSaving(true);
        const prefix = type === 'Invoice' ? 'INV' : type === 'Estimate' ? 'EST' : type === 'CreditMemo' ? 'MEMO' : 'RCPT';
        const res = await createInvoiceAction({
            invoice_number: `${prefix}${Date.now().toString().slice(-6)}`,
            type,
            status: type === 'Receipt' ? 'Paid' : 'Pending',
            customer_id: customer || null,
            date: format(date || new Date(), "yyyy-MM-dd"),
            due_date: dueDate ? format(dueDate, "yyyy-MM-dd") : undefined,
            subtotal,
            tax,
            total,
            vat_included: includeVat,
            notes
        }, lineItems);

        if (res.success) {
            onSave();
            setIsOpen(false);
        } else {
            alert(res.error);
        }
        setIsSaving(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New {type === 'CreditMemo' ? 'Credit Memo' : type}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
                <DialogHeader><DialogTitle>Create {type}</DialogTitle></DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select value={customer} onValueChange={setCustomer}>
                                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                                <SelectContent>
                                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Input type="date" value={date ? format(date, 'yyyy-MM-dd') : ''} onChange={(e) => setDate(new Date(e.target.value))} />
                        </div>
                        {type === 'Invoice' && (
                             <div className="space-y-2">
                                <Label>Due Date</Label>
                                <Input type="date" value={dueDate ? format(dueDate, 'yyyy-MM-dd') : ''} onChange={(e) => setDueDate(new Date(e.target.value))} />
                            </div>
                        )}
                    </div>

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Item</TableHead>
                                    <TableHead className="w-[100px]">Qty</TableHead>
                                    <TableHead className="w-[120px]">Price</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lineItems.map(line => (
                                    <TableRow key={line.id}>
                                        <TableCell>
                                            <Select onValueChange={(val) => {
                                                const item = catalogItems.find(i => i.id === val);
                                                if(item) setLineItems(lineItems.map(l => l.id === line.id ? { ...l, item: item.name, price: item.price, total: l.quantity * item.price } : l));
                                            }}>
                                                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                                                <SelectContent>{catalogItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell><Input type="number" value={line.quantity} onChange={(e) => setLineItems(lineItems.map(l => l.id === line.id ? { ...l, quantity: parseInt(e.target.value), total: parseInt(e.target.value) * l.price } : l))} /></TableCell>
                                        <TableCell><Input type="number" value={line.price} onChange={(e) => setLineItems(lineItems.map(l => l.id === line.id ? { ...l, price: parseFloat(e.target.value), total: l.quantity * parseFloat(e.target.value) } : l))} /></TableCell>
                                        <TableCell className="text-right">₦{line.total.toLocaleString()}</TableCell>
                                        <TableCell><Button variant="ghost" size="icon" onClick={() => setLineItems(lineItems.filter(l => l.id !== line.id))}><X className="h-4 w-4" /></Button></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setLineItems([...lineItems, { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }])}>Add Item</Button>

                    <div className="flex justify-end gap-12">
                        <div className="flex items-center space-x-2"><Switch checked={includeVat} onCheckedChange={setIncludeVat} /><Label>VAT (7.5%)</Label></div>
                        <div className="w-48 space-y-2">
                            <div className="flex justify-between text-sm"><span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span></div>
                            <div className="flex justify-between font-bold text-lg"><span>Total</span><span>₦{total.toLocaleString()}</span></div>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave} disabled={isSaving} className="w-full">
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : `Create ${type}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
