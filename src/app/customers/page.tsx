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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

type Customer = {
    id: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    address?: string;
    spend: number;
    loyalty: "Gold" | "Silver" | "Bronze" | "New";
}

const initialCustomers: Customer[] = [
    { id: "cust-001", name: "Alice Johnson", email: "alice@example.com", phone: "+234 801 234 5678", company: "Johnson Innovations", address: "123 Tech Road, Lagos", spend: 2540.50, loyalty: "Gold" },
    { id: "cust-002", name: "Bob Williams", email: "bob@example.com", company: "Williams Solutions", spend: 1820.00, loyalty: "Silver" },
    { id: "cust-003", name: "Charlie Brown", email: "charlie@example.com", spend: 850.75, loyalty: "Bronze" },
    { id: "cust-004", name: "Diana Miller", email: "diana@example.com", phone: "+234 802 345 6789", address: "456 Business Ave, Abuja", spend: 3200.00, loyalty: "Gold" },
    { id: "cust-005", name: "Ethan Davis", email: "ethan@example.com", spend: 450.25, loyalty: "New" },
]

function AddCustomerDialog({ onSave }: { onSave: (newCustomer: Customer) => void }) {
    const [name, setName] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [phone, setPhone] = React.useState('');
    const [company, setCompany] = React.useState('');
    const [address, setAddress] = React.useState('');
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);

    const handleSave = () => {
        if (name && email) {
            const newCustomer: Customer = {
                id: `cust-${Date.now()}`,
                name,
                email,
                phone: phone || undefined,
                company: company || undefined,
                address: address || undefined,
                spend: 0,
                loyalty: 'New',
            };
            onSave(newCustomer);
            setIsDialogOpen(false);
            setName('');
            setEmail('');
            setPhone('');
            setCompany('');
            setAddress('');
        }
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                 <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Customer
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add New Customer</DialogTitle>
                    <DialogDescription>Enter the new customer's details below.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-name" className="text-right">Name</Label>
                        <Input
                            id="customer-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-email" className="text-right">Email</Label>
                        <Input
                            id="customer-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g. john@example.com"
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-phone" className="text-right">Phone <span className="text-muted-foreground/80">(Opt)</span></Label>
                        <Input
                            id="customer-phone"
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="col-span-3"
                            placeholder="+234..."
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-company" className="text-right">Company <span className="text-muted-foreground/80">(Opt)</span></Label>
                        <Input
                            id="customer-company"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g. ACME Inc."
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-address" className="text-right">Address <span className="text-muted-foreground/80">(Opt)</span></Label>
                        <Input
                            id="customer-address"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="col-span-3"
                            placeholder="123 Main St, City"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                     <Button type="submit" onClick={handleSave} disabled={!name || !email}>Save Customer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function CustomersPage() {
    const [customers, setCustomers] = React.useState(initialCustomers);
    const { toast } = useToast();
    
    const handleAddCustomer = (newCustomer: Customer) => {
        setCustomers(prev => [newCustomer, ...prev]);
    }

    const createToast = (title: string, description: string) => {
        toast({ title, description });
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="font-headline">Customers</CardTitle>
                        <CardDescription>Manage your customer database and loyalty.</CardDescription>
                    </div>
                    <AddCustomerDialog onSave={handleAddCustomer} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead className="hidden sm:table-cell">Contact</TableHead>
                            <TableHead className="hidden md:table-cell">Loyalty Level</TableHead>
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
                                        <div className="text-sm text-muted-foreground md:hidden">{customer.email}</div>
                                    </TableCell>
                                     <TableCell className="hidden sm:table-cell">
                                        <div className="font-medium">{customer.email}</div>
                                        {customer.phone && <div className="text-sm text-muted-foreground">{customer.phone}</div>}
                                     </TableCell>
                                    <TableCell className="hidden md:table-cell">
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
                                                <DropdownMenuItem onClick={() => createToast('Viewing Profile', `Displaying profile for ${customer.name}.`)}>View Profile</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => createToast('Sending Message', `Opening message composer for ${customer.name}.`)}>Send Message</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => createToast('Viewing History', `Fetching purchase history for ${customer.name}.`)}>View Purchase History</DropdownMenuItem>
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
                Showing <strong>1-{customers.length}</strong> of <strong>{customers.length}</strong> customers
                </div>
            </CardFooter>
        </Card>
    )
}
