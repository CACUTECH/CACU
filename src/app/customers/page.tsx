
"use client"
import * as React from "react"
import { 
    MoreHorizontal, 
    PlusCircle, 
    Search, 
    Mail, 
    Phone, 
    Send, 
    History, 
    User, 
    MapPin, 
    Building2,
    Calendar as CalendarIcon,
    ArrowUpRight,
    AlertCircle,
    CheckCircle2,
    Users,
    Wallet,
    TrendingUp
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type TransactionRecord = {
    id: string;
    date: string;
    amount: number;
    description: string;
    status: 'Paid' | 'Pending' | 'Overdue';
}

type Customer = {
    id: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    address?: string;
    spend: number; // Lifetime Value
    loyalty: "Gold" | "Silver" | "Bronze" | "New";
    lastActive: string;
    history: TransactionRecord[];
}

const initialCustomers: Customer[] = [
    { 
        id: "cust-001", 
        name: "Alice Johnson", 
        email: "alice@example.com", 
        phone: "+234 801 234 5678", 
        company: "Johnson Innovations", 
        address: "123 Tech Road, Lagos", 
        spend: 254000, 
        loyalty: "Gold",
        lastActive: "2024-07-20",
        history: [
            { id: "tx-1", date: "2024-07-20", amount: 150000, description: "Consulting Services", status: "Paid" },
            { id: "tx-2", date: "2024-06-15", amount: 104000, description: "Software License", status: "Paid" },
        ]
    },
    { 
        id: "cust-002", 
        name: "Bob Williams", 
        email: "bob@example.com", 
        phone: "+234 802 345 6789",
        company: "Williams Solutions", 
        spend: 182000, 
        loyalty: "Silver",
        lastActive: "2024-07-19",
        history: [
            { id: "tx-3", date: "2024-07-19", amount: 182000, description: "Hardware Upgrade", status: "Pending" },
        ]
    },
    { 
        id: "cust-003", 
        name: "Charlie Brown", 
        email: "charlie@example.com", 
        spend: 85075, 
        loyalty: "Bronze",
        lastActive: "2024-07-10",
        history: [
            { id: "tx-4", date: "2024-07-10", amount: 85075, description: "Maintenance Fee", status: "Overdue" },
        ]
    },
    { 
        id: "cust-004", 
        name: "Diana Miller", 
        email: "diana@example.com", 
        phone: "+234 802 345 6789", 
        address: "456 Business Ave, Abuja", 
        spend: 320000, 
        loyalty: "Gold",
        lastActive: "2024-07-23",
        history: [
            { id: "tx-5", date: "2024-07-23", amount: 320000, description: "Bulk Office Supplies", status: "Paid" },
        ]
    },
    { 
        id: "cust-005", 
        name: "Ethan Davis", 
        email: "ethan@example.com", 
        spend: 45025, 
        loyalty: "New",
        lastActive: "2024-07-24",
        history: [
            { id: "tx-6", date: "2024-07-24", amount: 45025, description: "Trial Product Pack", status: "Paid" },
        ]
    },
]

function CRMStatCard({ title, value, subtext, icon: Icon }: { title: string, value: string, subtext: string, icon: React.ElementType }) {
    return (
        <Card className="hover:shadow-md transition-shadow bg-primary/5 border-primary/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    )
}

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
                lastActive: new Date().toISOString().split('T')[0],
                history: [],
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
                 <Button className="rounded-xl shadow-lg shadow-primary/20">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Customer
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="font-headline text-xl">Add New Profile</DialogTitle>
                    <DialogDescription>Create a new entry in your customer relationship database.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-name" className="text-right">Name</Label>
                        <Input
                            id="customer-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="col-span-3 rounded-lg"
                            placeholder="Full Name"
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-email" className="text-right">Email</Label>
                        <Input
                            id="customer-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="col-span-3 rounded-lg"
                            placeholder="email@example.com"
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-phone" className="text-right">Phone</Label>
                        <Input
                            id="customer-phone"
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="col-span-3 rounded-lg"
                            placeholder="+234..."
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="customer-company" className="text-right">Company</Label>
                        <Input
                            id="customer-company"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            className="col-span-3 rounded-lg"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                     <Button type="submit" onClick={handleSave} disabled={!name || !email}>Save to CRM</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CustomerDetailsSheet({ customer, onSendReminder }: { customer: Customer, onSendReminder: (name: string) => void }) {
    return (
        <SheetContent className="sm:max-w-xl">
            <SheetHeader className="border-b pb-6">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-4 rounded-2xl">
                        <User className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                        <SheetTitle className="text-2xl font-headline text-left">{customer.name}</SheetTitle>
                        <SheetDescription className="flex items-center gap-2">
                            <Building2 className="h-3 w-3" /> {customer.company || "Individual Customer"}
                        </SheetDescription>
                    </div>
                </div>
            </SheetHeader>

            <ScrollArea className="h-[calc(100vh-120px)] py-6 pr-4">
                <div className="space-y-8">
                    {/* CRM Profile Card */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl border bg-muted/30">
                            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Lifetime Value</p>
                            <p className="text-xl font-bold font-headline">₦{customer.spend.toLocaleString()}</p>
                        </div>
                        <div className="p-4 rounded-xl border bg-muted/30">
                            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Loyalty Tier</p>
                            <Badge className={cn(
                                "mt-1",
                                customer.loyalty === 'Gold' && "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
                                customer.loyalty === 'Silver' && "bg-slate-400/10 text-slate-600 border-slate-400/20",
                                customer.loyalty === 'Bronze' && "bg-orange-400/10 text-orange-600 border-orange-400/20"
                            )} variant="outline">
                                {customer.loyalty}
                            </Badge>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Contact Details</h4>
                        <div className="grid gap-3">
                            <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-card border">
                                <Mail className="h-4 w-4 text-primary" />
                                <span className="flex-1 font-medium">{customer.email}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6"><ArrowUpRight className="h-3 w-3" /></Button>
                            </div>
                            <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-card border">
                                <Phone className="h-4 w-4 text-primary" />
                                <span className="flex-1 font-medium">{customer.phone || "No phone recorded"}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6"><ArrowUpRight className="h-3 w-3" /></Button>
                            </div>
                            <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-card border">
                                <MapPin className="h-4 w-4 text-primary" />
                                <span className="flex-1 font-medium">{customer.address || "No address recorded"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Transaction History</h4>
                            <History className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="space-y-3">
                            {customer.history.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground bg-muted/10 rounded-xl border border-dashed">
                                    No history found
                                </div>
                            ) : customer.history.map((tx) => (
                                <div key={tx.id} className="p-4 rounded-xl border bg-card hover:bg-muted/10 transition-colors flex items-center justify-between">
                                    <div className="space-y-1">
                                        <p className="font-bold text-sm">{tx.description}</p>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            <CalendarIcon className="h-3 w-3" /> {tx.date}
                                        </p>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <p className="font-bold font-headline">₦{tx.amount.toLocaleString()}</p>
                                        <Badge 
                                            variant={tx.status === 'Overdue' ? 'destructive' : tx.status === 'Pending' ? 'secondary' : 'default'}
                                            className={cn(
                                                "text-[10px] h-5",
                                                tx.status === 'Paid' && "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"
                                            )}
                                        >
                                            {tx.status}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="pt-4 border-t space-y-4">
                         <h4 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">CRM Actions</h4>
                         <div className="grid grid-cols-2 gap-3">
                             <Button variant="outline" className="w-full justify-start h-auto py-3 px-4 rounded-xl gap-3 border-primary/10 hover:bg-primary/5 hover:text-primary transition-all shadow-sm" onClick={() => onSendReminder(customer.name)}>
                                <div className="bg-primary/10 p-2 rounded-lg">
                                    <Send className="h-4 w-4 text-primary" />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-bold">Payment Reminder</p>
                                    <p className="text-[10px] text-muted-foreground">Send via Email/SMS</p>
                                </div>
                             </Button>
                             <Button variant="outline" className="w-full justify-start h-auto py-3 px-4 rounded-xl gap-3 border-primary/10 hover:bg-primary/5 hover:text-primary transition-all shadow-sm">
                                <div className="bg-primary/10 p-2 rounded-lg">
                                    <Phone className="h-4 w-4 text-primary" />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-bold">Log Interaction</p>
                                    <p className="text-[10px] text-muted-foreground">Record call or visit</p>
                                </div>
                             </Button>
                         </div>
                    </div>
                </div>
            </ScrollArea>
        </SheetContent>
    )
}

export default function CustomersPage() {
    const [customers, setCustomers] = React.useState(initialCustomers);
    const [searchTerm, setSearchTerm] = React.useState("");
    const { toast } = useToast();
    
    const handleAddCustomer = (newCustomer: Customer) => {
        setCustomers(prev => [newCustomer, ...prev]);
        toast({
            title: "Customer Added",
            description: `${newCustomer.name} has been saved to your CRM.`,
        });
    }

    const handleSendReminder = (name: string) => {
        toast({
            title: "Reminder Sent",
            description: `Payment reminder has been sent to ${name} via Email and SMS.`,
            action: (
                <div className="flex items-center gap-1 text-emerald-600 font-bold text-xs uppercase tracking-tighter">
                    <CheckCircle2 className="h-3 w-3" /> Sent
                </div>
            )
        });
    }

    const filteredCustomers = customers.filter(c => 
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.company && c.company.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const totalLtv = customers.reduce((acc, c) => acc + c.spend, 0);
    const overdueCount = customers.reduce((acc, c) => acc + c.history.filter(tx => tx.status === 'Overdue').length, 0);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Customer Relationships</h1>
                    <p className="text-muted-foreground mt-1">Store contact details, track history, and grow your customer lifetime value.</p>
                </div>
                <AddCustomerDialog onSave={handleAddCustomer} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <CRMStatCard 
                    title="Total Customers" 
                    value={customers.length.toString()} 
                    subtext="+2 new this week" 
                    icon={Users} 
                />
                <CRMStatCard 
                    title="Portfolio LTV" 
                    value={`₦${(totalLtv / 1000000).toFixed(2)}M`} 
                    subtext="Average ₦125k per user" 
                    icon={Wallet} 
                />
                <CRMStatCard 
                    title="Active Deals" 
                    value={customers.filter(c => c.history.some(tx => tx.status === 'Pending')).length.toString()} 
                    subtext="Requires follow-up" 
                    icon={TrendingUp} 
                />
                <CRMStatCard 
                    title="Overdue Reminders" 
                    value={overdueCount.toString()} 
                    subtext="Critical attention" 
                    icon={AlertCircle} 
                />
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <CardTitle className="font-headline">Database Directory</CardTitle>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search profiles..." 
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
                                <TableHead>Customer</TableHead>
                                <TableHead className="hidden sm:table-cell">Relationship</TableHead>
                                <TableHead className="hidden md:table-cell">LTV / Loyalty</TableHead>
                                <TableHead className="text-right">Last Interaction</TableHead>
                                <TableHead><span className="sr-only">Actions</span></TableHead>
                            </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCustomers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                            No customers found matching "{searchTerm}"
                                        </TableCell>
                                    </TableRow>
                                ) : filteredCustomers.map(customer => (
                                    <Sheet key={customer.id}>
                                        <TableRow className="group hover:bg-primary/5 transition-colors cursor-pointer">
                                            <TableCell>
                                                <SheetTrigger asChild>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase">
                                                            {customer.name.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold group-hover:text-primary transition-colors">{customer.name}</div>
                                                            <div className="text-xs text-muted-foreground">{customer.email}</div>
                                                        </div>
                                                    </div>
                                                </SheetTrigger>
                                            </TableCell>
                                            <TableCell className="hidden sm:table-cell">
                                                <div className="text-sm font-medium">{customer.company || "Personal"}</div>
                                                <div className="text-xs text-muted-foreground">{customer.phone}</div>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell">
                                                <div className="font-bold font-headline">₦{customer.spend.toLocaleString()}</div>
                                                <Badge 
                                                    variant="outline"
                                                    className={cn(
                                                        "text-[10px] py-0 h-4 mt-1",
                                                        customer.loyalty === "Gold" ? "bg-yellow-400/10 text-yellow-600 border-yellow-400/20" : 
                                                        customer.loyalty === "Silver" ? "bg-gray-400/10 text-gray-600" : ""
                                                    )}
                                                >
                                                    {customer.loyalty}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="text-sm">{customer.lastActive}</div>
                                                {customer.history.some(tx => tx.status === 'Overdue') && (
                                                    <div className="text-[10px] text-red-500 font-bold flex items-center justify-end gap-1 uppercase">
                                                        <AlertCircle className="h-2 w-2" /> Payment Overdue
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex justify-end">
                                                    <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button aria-haspopup="true" size="icon" variant="ghost" className="rounded-full">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                            <span className="sr-only">Toggle menu</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl">
                                                        <DropdownMenuLabel>CRM Actions</DropdownMenuLabel>
                                                        <SheetTrigger asChild>
                                                            <DropdownMenuItem>View CRM Profile</DropdownMenuItem>
                                                        </SheetTrigger>
                                                        <DropdownMenuItem onClick={() => handleSendReminder(customer.name)}>Send Reminder</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="text-destructive">Delete Profile</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                        <CustomerDetailsSheet customer={customer} onSendReminder={handleSendReminder} />
                                    </Sheet>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
                <CardFooter className="bg-muted/5 border-t">
                    <div className="text-xs text-muted-foreground py-2">
                        Displaying <strong>{filteredCustomers.length}</strong> profiles in your relationship database.
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
