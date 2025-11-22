"use client"

import * as React from "react"
import {
  MoreHorizontal,
  PlusCircle,
  File,
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

const allInvoices = invoices.filter(invoice => invoice.paymentStatus !== "Paid");
const receipts = invoices.filter(invoice => invoice.paymentStatus === "Paid");

function InvoiceTable({ data }: { data: typeof invoices }) {
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
                                {invoice.paymentStatus !== 'Paid' && <DropdownMenuItem>Mark as Paid</DropdownMenuItem>}
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
                <Button size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {activeTab === "invoices" ? "Add Invoice" : "Add Receipt"}
                </Button>
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
                <InvoiceTable data={allInvoices} />
                 <CardFooter className="pt-6">
                    <div className="text-xs text-muted-foreground">
                    Showing <strong>1-{allInvoices.length}</strong> of <strong>{allInvoices.length}</strong> invoices
                    </div>
                </CardFooter>
            </TabsContent>
             <TabsContent value="receipts" className="mt-4">
                <InvoiceTable data={receipts} />
                 <CardFooter className="pt-6">
                    <div className="text-xs text-muted-foreground">
                    Showing <strong>1-{receipts.length}</strong> of <strong>{receipts.length}</strong> receipts
                    </div>
                </CardFooter>
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
