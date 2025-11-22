"use client"

import * as React from "react"
import {
  MoreHorizontal,
  PlusCircle,
  File,
  X,
  Plus,
  Calendar as CalendarIcon,
} from "lucide-react"

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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

import { inventoryItems } from "@/lib/data"
import type { InventoryItem } from "@/lib/data"


const invoices = [
  {
    invoice: "INV001",
    paymentStatus: "Paid",
    totalAmount: "₦250.00",
    paymentMethod: "Credit Card",
    customerName: "Alice Johnson",
    date: "2024-07-20",
  },
  {
    invoice: "INV002",
    paymentStatus: "Pending",
    totalAmount: "₦150.00",
    paymentMethod: "PayPal",
    customerName: "Bob Williams",
    date: "2024-07-21",
  },
  {
    invoice: "INV003",
    paymentStatus: "Unpaid",
    totalAmount: "₦350.00",
    paymentMethod: "Bank Transfer",
    customerName: "Charlie Brown",
     date: "2024-07-22",
  },
  {
    invoice: "INV004",
    paymentStatus: "Paid",
    totalAmount: "₦450.00",
    paymentMethod: "Credit Card",
    customerName: "Diana Miller",
     date: "2024-07-23",
  },
  {
    invoice: "INV005",
    paymentStatus: "Paid",
    totalAmount: "₦550.00",
    paymentMethod: "PayPal",
    customerName: "Ethan Davis",
    date: "2024-07-24",
  },
  {
    invoice: "INV006",
    paymentStatus: "Pending",
    totalAmount: "₦200.00",
    paymentMethod: "Bank Transfer",
    customerName: "Fiona Green",
    date: "2024-07-25",
  },
  {
    invoice: "INV007",
    paymentStatus: "Unpaid",
    totalAmount: "₦300.00",
    paymentMethod: "Credit Card",
    customerName: "George Hill",
    date: "2024-07-26",
  },
]

const customers = [
    { id: "cust-001", name: "Alice Johnson" },
    { id: "cust-002", name: "Bob Williams" },
    { id: "cust-003", name: "Charlie Brown" },
]

const allInvoices = invoices.filter(invoice => invoice.paymentStatus !== "Paid");
const receipts = invoices.filter(invoice => invoice.paymentStatus === "Paid");

type LineItem = {
    id: string;
    item: string;
    quantity: number;
    price: number;
    total: number;
}

function AddReceiptDialog({ onSave }: { onSave: (newReceipt: any) => void }) {
    const [customer, setCustomer] = React.useState('');
    const [receiptDate, setReceiptDate] = React.useState<Date | undefined>(new Date());
    const [lineItems, setLineItems] = React.useState<LineItem[]>([
        { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }
    ]);
     const [paymentMethod, setPaymentMethod] = React.useState('');

    const handleItemChange = (id: string, selectedItemId: string) => {
        const selectedItem = inventoryItems.find(i => i.id === selectedItemId);
        if (selectedItem) {
            setLineItems(lineItems.map(line =>
                line.id === id ? { ...line, item: selectedItem.name, price: selectedItem.price, total: line.quantity * selectedItem.price } : line
            ));
        }
    };

    const handleQuantityChange = (id: string, quantity: number) => {
        setLineItems(lineItems.map(line =>
            line.id === id ? { ...line, quantity, total: quantity * line.price } : line
        ));
    };

    const handlePriceChange = (id: string, price: number) => {
        setLineItems(lineItems.map(line =>
            line.id === id ? { ...line, price, total: line.quantity * price } : line
        ));
    };

    const addLineItem = () => {
        setLineItems([...lineItems, { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }]);
    };

    const removeLineItem = (id: string) => {
        setLineItems(lineItems.filter(line => line.id !== id));
    };

    const subtotal = React.useMemo(() => lineItems.reduce((acc, item) => acc + item.total, 0), [lineItems]);
    const tax = subtotal * 0.075; // Assuming 7.5% VAT
    const total = subtotal + tax;

    const handleSave = () => {
        const newReceipt = {
            invoice: `RCPT${(Math.random() * 1000).toFixed(0).padStart(3, '0')}`,
            paymentStatus: "Paid",
            totalAmount: `₦${total.toLocaleString()}`,
            paymentMethod: paymentMethod || "Cash",
            customerName: customers.find(c => c.id === customer)?.name || 'Unknown',
            date: format(receiptDate || new Date(), "yyyy-MM-dd"),
            items: lineItems
        };
        onSave(newReceipt);
    }

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Receipt
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Create New Receipt</DialogTitle>
                    <DialogDescription>Fill out the details below to create a new receipt for a sale.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select onValueChange={setCustomer}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {customers.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                             <Label>Receipt Date</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !receiptDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {receiptDate ? format(receiptDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={receiptDate} onSelect={setReceiptDate} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>Payment Method</Label>
                            <Select onValueChange={setPaymentMethod}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select payment method" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Cash">Cash</SelectItem>
                                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                                    <SelectItem value="PayPal">PayPal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label>Items Sold</Label>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Item</TableHead>
                                        <TableHead className="w-[100px]">Quantity</TableHead>
                                        <TableHead className="w-[120px]">Price</TableHead>
                                        <TableHead className="w-[120px] text-right">Total</TableHead>
                                        <TableHead className="w-[50px]"><span className="sr-only">Actions</span></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {lineItems.map(line => (
                                        <TableRow key={line.id}>
                                            <TableCell>
                                                <Select onValueChange={(value) => handleItemChange(line.id, value)}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select an item" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {inventoryItems.map(item => (
                                                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Input type="number" value={line.quantity} onChange={(e) => handleQuantityChange(line.id, parseInt(e.target.value))} min="1" />
                                            </TableCell>
                                             <TableCell>
                                                <Input type="number" value={line.price} onChange={(e) => handlePriceChange(line.id, parseFloat(e.target.value))} />
                                            </TableCell>
                                            <TableCell className="text-right">₦{line.total.toLocaleString()}</TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" onClick={() => removeLineItem(line.id)}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <Button variant="outline" size="sm" onClick={addLineItem} className="mt-2">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Item
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div className="md:col-start-3 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>₦{subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">VAT (7.5%)</span>
                                <span>₦{tax.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-bold text-lg">
                                <span>Total</span>
                                <span>₦{total.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea placeholder="Add any notes for the customer..." />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave} className="w-full sm:w-auto">Save Receipt</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


function AddInvoiceDialog({ onSave }: { onSave: (newInvoice: any) => void }) {
    const [customer, setCustomer] = React.useState('');
    const [invoiceDate, setInvoiceDate] = React.useState<Date | undefined>(new Date());
    const [dueDate, setDueDate] = React.useState<Date | undefined>();
    const [lineItems, setLineItems] = React.useState<LineItem[]>([
        { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }
    ]);

    const handleItemChange = (id: string, selectedItemId: string) => {
        const selectedItem = inventoryItems.find(i => i.id === selectedItemId);
        if (selectedItem) {
            setLineItems(lineItems.map(line =>
                line.id === id ? { ...line, item: selectedItem.name, price: selectedItem.price, total: line.quantity * selectedItem.price } : line
            ));
        }
    };

    const handleQuantityChange = (id: string, quantity: number) => {
        setLineItems(lineItems.map(line =>
            line.id === id ? { ...line, quantity, total: quantity * line.price } : line
        ));
    };

    const handlePriceChange = (id: string, price: number) => {
        setLineItems(lineItems.map(line =>
            line.id === id ? { ...line, price, total: line.quantity * price } : line
        ));
    };

    const addLineItem = () => {
        setLineItems([...lineItems, { id: crypto.randomUUID(), item: '', quantity: 1, price: 0, total: 0 }]);
    };

    const removeLineItem = (id: string) => {
        setLineItems(lineItems.filter(line => line.id !== id));
    };

    const subtotal = React.useMemo(() => lineItems.reduce((acc, item) => acc + item.total, 0), [lineItems]);
    const tax = subtotal * 0.075; // Assuming 7.5% VAT
    const total = subtotal + tax;

    const handleSave = () => {
        const newInvoice = {
            invoice: `INV${(Math.random() * 1000).toFixed(0).padStart(3, '0')}`,
            paymentStatus: "Pending",
            totalAmount: `₦${total.toLocaleString()}`,
            paymentMethod: "N/A",
            customerName: customers.find(c => c.id === customer)?.name || 'Unknown',
            date: format(invoiceDate || new Date(), "yyyy-MM-dd"),
            items: lineItems
        };
        onSave(newInvoice);
    }

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Invoice
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Create New Invoice</DialogTitle>
                    <DialogDescription>Fill out the details below to create a new invoice.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select onValueChange={setCustomer}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {customers.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                             <Label>Invoice Date</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !invoiceDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {invoiceDate ? format(invoiceDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={invoiceDate} onSelect={setInvoiceDate} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                         <div className="space-y-2">
                             <Label>Due Date</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dueDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dueDate ? format(dueDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label>Invoice Items</Label>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Item</TableHead>
                                        <TableHead className="w-[100px]">Quantity</TableHead>
                                        <TableHead className="w-[120px]">Price</TableHead>
                                        <TableHead className="w-[120px] text-right">Total</TableHead>
                                        <TableHead className="w-[50px]"><span className="sr-only">Actions</span></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {lineItems.map(line => (
                                        <TableRow key={line.id}>
                                            <TableCell>
                                                <Select onValueChange={(value) => handleItemChange(line.id, value)}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select an item" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {inventoryItems.map(item => (
                                                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Input type="number" value={line.quantity} onChange={(e) => handleQuantityChange(line.id, parseInt(e.target.value))} min="1" />
                                            </TableCell>
                                             <TableCell>
                                                <Input type="number" value={line.price} onChange={(e) => handlePriceChange(line.id, parseFloat(e.target.value))} />
                                            </TableCell>
                                            <TableCell className="text-right">₦{line.total.toLocaleString()}</TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" onClick={() => removeLineItem(line.id)}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <Button variant="outline" size="sm" onClick={addLineItem} className="mt-2">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Item
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div className="md:col-start-3 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span>₦{subtotal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">VAT (7.5%)</span>
                                <span>₦{tax.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-bold text-lg">
                                <span>Total</span>
                                <span>₦{total.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea placeholder="Add any notes for the customer..." />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave} className="w-full sm:w-auto">Save Invoice</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


function InvoiceTable({ data, onMarkAsPaid }: { data: typeof invoices, onMarkAsPaid: (invoiceId: string) => void }) {
    return (
        <div className="rounded-md border">
            <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>
                        <span className="sr-only">Actions</span>
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((invoice) => (
                <TableRow key={invoice.invoice}>
                    <TableCell>
                        <div className="font-medium">{invoice.customerName}</div>
                        <div className="text-sm text-muted-foreground">{invoice.invoice}</div>
                    </TableCell>
                    <TableCell>
                        <Badge variant={
                            invoice.paymentStatus === "Paid" ? "default" :
                            invoice.paymentStatus === "Pending" ? "secondary" :
                            "destructive"
                        }>
                            {invoice.paymentStatus}
                        </Badge>
                    </TableCell>
                    <TableCell>{invoice.date}</TableCell>
                    <TableCell className="text-right">{invoice.totalAmount}</TableCell>
                    <TableCell>
                        <div className="flex justify-end">
                            <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="icon" variant="ghost">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem>View Details</DropdownMenuItem>
                                {invoice.paymentStatus !== 'Paid' && <DropdownMenuItem onClick={() => onMarkAsPaid(invoice.invoice)}>Mark as Paid</DropdownMenuItem>}
                                <DropdownMenuItem>Download PDF</DropdownMenuItem>
                            </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </TableCell>
                </TableRow>
                ))}
            </TableBody>
            </Table>
        </div>
    )
}

export default function InvoicesPage() {
  const [activeTab, setActiveTab] = React.useState("invoices");
  const [allInvoicesState, setAllInvoicesState] = React.useState(allInvoices);
  const [receiptsState, setReceiptsState] = React.useState(receipts);

  const handleSave = (newItem: any) => {
    if (newItem.paymentStatus === 'Paid') {
        setReceiptsState([newItem, ...receiptsState]);
    } else {
        setAllInvoicesState([newItem, ...allInvoicesState]);
    }
  }

  const handleMarkAsPaid = (invoiceId: string) => {
    const itemToMove = allInvoicesState.find(inv => inv.invoice === invoiceId);
    if (itemToMove) {
        setAllInvoicesState(allInvoicesState.filter(inv => inv.invoice !== invoiceId));
        setReceiptsState([{ ...itemToMove, paymentStatus: 'Paid' }, ...receiptsState]);
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
            <div>
                <CardTitle>Invoices & Receipts</CardTitle>
                <CardDescription>
                    Manage your invoices and view customer receipts.
                </CardDescription>
            </div>
            <div className="flex items-center gap-2">
                <Button size="sm" variant="outline">
                    <File className="mr-2 h-4 w-4" />
                    Export
                </Button>
                {activeTab === 'invoices' ? <AddInvoiceDialog onSave={handleSave} /> : <AddReceiptDialog onSave={handleSave} />}
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="invoices" onValueChange={setActiveTab}>
            <TabsList>
                <TabsTrigger value="invoices">Invoices</TabsTrigger>
                <TabsTrigger value="receipts">Receipts</TabsTrigger>
            </TabsList>
            <TabsContent value="invoices" className="mt-4">
                <InvoiceTable data={allInvoicesState} onMarkAsPaid={handleMarkAsPaid} />
                 <CardFooter className="pt-6">
                    <div className="text-xs text-muted-foreground">
                    Showing <strong>1-{allInvoicesState.length}</strong> of <strong>{allInvoicesState.length}</strong> invoices
                    </div>
                </CardFooter>
            </TabsContent>
             <TabsContent value="receipts" className="mt-4">
                <InvoiceTable data={receiptsState} onMarkAsPaid={() => {}} />
                 <CardFooter className="pt-6">
                    <div className="text-xs text-muted-foreground">
                    Showing <strong>1-{receiptsState.length}</strong> of <strong>{receiptsState.length}</strong> receipts
                    </div>
                </CardFooter>
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
