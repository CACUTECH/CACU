
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
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

import { inventoryItems } from "@/lib/data"
import type { InventoryItem } from "@/lib/data"

type Customer = {
    id: string;
    name: string;
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
    invoice: string;
    type: InvoiceType;
    paymentStatus: "Paid" | "Pending" | "Unpaid" | "Accepted" | "Refunded";
    totalAmount: string;
    paymentMethod: string;
    customerName: string;
    date: string;
    items?: LineItem[];
    notes?: string;
    dueDate?: string;
    subtotal: number;
    tax: number;
    total: number;
    vatIncluded: boolean;
}

const initialCustomers: Customer[] = [
    { id: "cust-001", name: "Alice Johnson" },
    { id: "cust-002", name: "Bob Williams" },
    { id: "cust-003", name: "Charlie Brown" },
]

const invoicesData: Invoice[] = [
  {
    invoice: "INV001",
    type: "Invoice",
    paymentStatus: "Paid",
    totalAmount: "₦250.00",
    paymentMethod: "Credit Card",
    customerName: "Alice Johnson",
    date: "2024-07-20",
    subtotal: 232.56,
    tax: 17.44,
    total: 250,
    vatIncluded: true,
  },
  {
    invoice: "EST001",
    type: "Estimate",
    paymentStatus: "Pending",
    totalAmount: "₦1,200.00",
    paymentMethod: "N/A",
    customerName: "Bob Williams",
    date: "2024-07-21",
    subtotal: 1116.28,
    tax: 83.72,
    total: 1200,
    vatIncluded: true,
  }
]

const downloadPdf = async (invoice: Invoice) => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const typeLabel = invoice.type === 'CreditMemo' ? 'Credit Memo' : invoice.type;

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(`${typeLabel} #${invoice.invoice}`, doc.internal.pageSize.getWidth() - 14, 22, { align: 'right' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const rightAlignX = doc.internal.pageSize.getWidth() - 14;
    doc.text(`Date: ${format(new Date(invoice.date), "PPP")}`, rightAlignX, 32, { align: 'right' });
    if(invoice.dueDate) {
         doc.text(`Due Date: ${format(new Date(invoice.dueDate), "PPP")}`, rightAlignX, 38, { align: 'right' });
    }
   
    doc.text(`Customer: ${invoice.customerName}`, 14, 60);

    if (invoice.items && invoice.items.length > 0) {
        (doc as any).autoTable({
            startY: 70,
            head: [['Item', 'Quantity', 'Price', 'Total']],
            body: invoice.items.map(item => [item.item, item.quantity, `₦${item.price.toFixed(2)}`, `₦${item.total.toFixed(2)}`]),
            theme: 'striped',
            headStyles: { fillColor: [82, 51, 255] }
        });
    }

    let finalY = (doc as any).lastAutoTable?.finalY || 80;
    let yPos = finalY + 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Subtotal:', 140, yPos);
    doc.text(`₦${invoice.subtotal.toFixed(2)}`, 200, yPos, { align: 'right' });
    
    if (invoice.vatIncluded) {
        yPos += 7;
        doc.text('VAT (7.5%):', 140, yPos);
        doc.text(`₦${invoice.tax.toFixed(2)}`, 200, yPos, { align: 'right' });
    }

    yPos += 8;
    doc.setFontSize(14);
    doc.text('Total:', 140, yPos);
    doc.text(`₦${invoice.total.toFixed(2)}`, 200, yPos, { align: 'right' });

    doc.save(`${invoice.type}_${invoice.invoice}.pdf`);
};

function AddCustomerDialog({ onSave }: { onSave: (newCustomer: Customer) => void }) {
    const [name, setName] = React.useState('');
    return (
        <Dialog>
            <DialogTrigger asChild>
                 <Button variant="ghost" className="justify-start w-full h-auto py-2 px-2 text-primary hover:text-primary">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add new customer
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add New Customer</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                         <Button onClick={() => onSave({ id: `cust-${Date.now()}`, name })} disabled={!name}>Save Customer</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CreateDocumentDialog({ 
    type, 
    onSave, 
    customers, 
    onCustomerAdd 
}: { 
    type: InvoiceType; 
    onSave: (doc: Invoice) => void; 
    customers: Customer[]; 
    onCustomerAdd: (c: Customer) => void; 
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

    const subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
    const tax = includeVat ? subtotal * 0.075 : 0;
    const total = subtotal + tax;

    const handleSave = () => {
        const prefix = type === 'Invoice' ? 'INV' : type === 'Estimate' ? 'EST' : type === 'CreditMemo' ? 'MEMO' : 'RCPT';
        const doc: Invoice = {
            invoice: `${prefix}${(Math.random() * 1000).toFixed(0).padStart(3, '0')}`,
            type,
            paymentStatus: type === 'Receipt' ? 'Paid' : 'Pending',
            totalAmount: `₦${total.toLocaleString()}`,
            paymentMethod: type === 'Receipt' ? 'Cash' : 'N/A',
            customerName: customers.find(c => c.id === customer)?.name || 'Unknown',
            date: format(date || new Date(), "yyyy-MM-dd"),
            dueDate: dueDate ? format(dueDate, "yyyy-MM-dd") : undefined,
            items: lineItems,
            notes,
            subtotal,
            tax,
            total,
            vatIncluded: includeVat,
        };
        onSave(doc);
        setIsOpen(false);
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
                <DialogHeader>
                    <DialogTitle>Create {type === 'CreditMemo' ? 'Credit Memo' : type}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select value={customer} onValueChange={setCustomer}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    <AddCustomerDialog onSave={(c) => { onCustomerAdd(c); setCustomer(c.id); }} />
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={setDate} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                        {type === 'Invoice' && (
                            <div className="space-y-2">
                                <Label>Due Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {dueDate ? format(dueDate, "PPP") : <span>Set due date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus /></PopoverContent>
                                </Popover>
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
                                                const item = inventoryItems.find(i => i.id === val);
                                                if(item) setLineItems(lineItems.map(l => l.id === line.id ? { ...l, item: item.name, price: item.price, total: l.quantity * item.price } : l));
                                            }}>
                                                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                                                <SelectContent>{inventoryItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
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
                <DialogFooter><Button onClick={handleSave} className="w-full">Create {type}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function InvoiceTable({ data, onAction }: { data: Invoice[], onAction: (action: string, inv: Invoice) => void }) {
    return (
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
                    {data.map((inv) => (
                        <TableRow key={inv.invoice}>
                            <TableCell className="font-medium">{inv.customerName}</TableCell>
                            <TableCell className="text-xs font-mono">{inv.invoice}</TableCell>
                            <TableCell>
                                <Badge variant={
                                    inv.paymentStatus === "Paid" || inv.paymentStatus === "Accepted" ? "default" :
                                    inv.paymentStatus === "Pending" ? "secondary" : "destructive"
                                } className={cn(
                                    inv.paymentStatus === "Paid" && "bg-emerald-500/10 text-emerald-700",
                                    inv.paymentStatus === "Accepted" && "bg-blue-500/10 text-blue-700",
                                )}>
                                    {inv.paymentStatus}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{inv.date}</TableCell>
                            <TableCell className="text-right font-bold">{inv.totalAmount}</TableCell>
                            <TableCell>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => downloadPdf(inv)}>Download PDF</DropdownMenuItem>
                                        {inv.type === 'Estimate' && inv.paymentStatus !== 'Accepted' && (
                                            <DropdownMenuItem onClick={() => onAction('convert', inv)} className="text-primary"><CheckCircle2 className="mr-2 h-4 w-4" /> Convert to Invoice</DropdownMenuItem>
                                        )}
                                        {inv.type === 'Invoice' && inv.paymentStatus !== 'Paid' && (
                                            <DropdownMenuItem onClick={() => onAction('pay', inv)}>Mark as Paid</DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                    {data.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No records found.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}

export default function InvoicesPage() {
  const [docs, setDocs] = React.useState<Invoice[]>(invoicesData);
  const [customers, setCustomers] = React.useState<Customer[]>(initialCustomers);
  const [activeTab, setActiveTab] = React.useState("invoices");
  const { toast } = useToast();

  const handleAction = (action: string, inv: Invoice) => {
    if (action === 'pay') {
        setDocs(docs.map(d => d.invoice === inv.invoice ? { ...d, paymentStatus: 'Paid', type: 'Receipt' } : d));
        toast({ title: "Payment Recorded", description: `Invoice ${inv.invoice} marked as paid.` });
    } else if (action === 'convert') {
        const newInvoice: Invoice = {
            ...inv,
            invoice: inv.invoice.replace('EST', 'INV'),
            type: 'Invoice',
            paymentStatus: 'Pending',
            dueDate: format(new Date(), 'yyyy-MM-dd'),
        };
        setDocs([...docs.map(d => d.invoice === inv.invoice ? { ...d, paymentStatus: 'Accepted' } : d), newInvoice]);
        toast({ title: "Estimate Converted", description: `Quote ${inv.invoice} converted to Invoice ${newInvoice.invoice}.` });
    }
  };

  const filteredDocs = docs.filter(d => {
    if (activeTab === 'invoices') return d.type === 'Invoice';
    if (activeTab === 'receipts') return d.type === 'Receipt';
    if (activeTab === 'estimates') return d.type === 'Estimate';
    if (activeTab === 'refunds') return d.type === 'CreditMemo';
    return false;
  });

  return (
    <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 className="font-headline text-3xl font-bold">Billing & Receivables</h1>
                <p className="text-muted-foreground">Manage quotes, invoices, receipts, and customer credits.</p>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"><File className="mr-2 h-4 w-4" /> Export All</Button>
                <CreateDocumentDialog 
                    type={activeTab === 'estimates' ? 'Estimate' : activeTab === 'refunds' ? 'CreditMemo' : activeTab === 'receipts' ? 'Receipt' : 'Invoice'} 
                    onSave={(d) => setDocs([d, ...docs])} 
                    customers={customers} 
                    onCustomerAdd={(c) => setCustomers([c, ...customers])} 
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
                <InvoiceTable data={filteredDocs} onAction={handleAction} />
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
                        ₦{docs.filter(d => d.type === 'Estimate' && d.paymentStatus === 'Pending').reduce((acc, d) => acc + d.total, 0).toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Projected revenue in the pipeline</p>
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
                        ₦{docs.filter(d => d.type === 'Invoice' && d.paymentStatus !== 'Paid').reduce((acc, d) => acc + d.total, 0).toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Pending customer payments</p>
                </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/10">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <RotateCcw className="h-4 w-4 text-red-500" /> Total Refunds Issued
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold font-headline">
                        ₦{docs.filter(d => d.type === 'CreditMemo').reduce((acc, d) => acc + d.total, 0).toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Credit given for returns/overpayments</p>
                </CardContent>
            </Card>
        </div>
    </div>
  )
}
