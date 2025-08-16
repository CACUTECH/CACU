"use client"
import * as React from "react"
import { MoreHorizontal, PlusCircle } from "lucide-react"

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

const customers = [
    { id: "cust-001", name: "Alice Johnson", email: "alice@example.com", spend: 2540.50, loyalty: "Gold" },
    { id: "cust-002", name: "Bob Williams", email: "bob@example.com", spend: 1820.00, loyalty: "Silver" },
    { id: "cust-003", name: "Charlie Brown", email: "charlie@example.com", spend: 850.75, loyalty: "Bronze" },
    { id: "cust-004", name: "Diana Miller", email: "diana@example.com", spend: 3200.00, loyalty: "Gold" },
    { id: "cust-005", name: "Ethan Davis", email: "ethan@example.com", spend: 450.25, loyalty: "New" },
]

export default function CustomersPage() {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="font-headline">Customers</CardTitle>
                        <CardDescription>Manage your customer database and loyalty.</CardDescription>
                    </div>
                    <Button>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Customer
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead>Loyalty Level</TableHead>
                            <TableHead className="text-right">Total Spend</TableHead>
                            <TableHead>
                            <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                            {customers.map(customer => (
                                <TableRow key={customer.id}>
                                    <TableCell>
                                        <div className="font-medium">{customer.name}</div>
                                        <div className="text-sm text-muted-foreground">{customer.email}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge 
                                            variant={customer.loyalty === "Gold" ? "default" : customer.loyalty === "Silver" ? "secondary" : "outline"}
                                            className={customer.loyalty === "Gold" ? "bg-yellow-400/20 text-yellow-600" : customer.loyalty === "Silver" ? "bg-gray-400/20 text-gray-600" : ""}
                                        >
                                            {customer.loyalty}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">₦{customer.spend.toLocaleString()}</TableCell>
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
                                                <DropdownMenuItem>View Profile</DropdownMenuItem>
                                                <DropdownMenuItem>Send Message</DropdownMenuItem>
                                                <DropdownMenuItem>View Purchase History</DropdownMenuItem>
                                            </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
            <CardFooter>
                <div className="text-xs text-muted-foreground">
                Showing <strong>1-5</strong> of <strong>{customers.length}</strong> customers
                </div>
            </CardFooter>
        </Card>
    )
}
