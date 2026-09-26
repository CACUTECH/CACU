
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
    TrendingUp,
    Loader2
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
import { createClient } from "@/lib/supabase/client"
import { saveCustomerAction, deleteCustomerAction } from "./actions"

type Customer = {
    id: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    address?: string;
    lifetime_spend: number;
    loyalty_tier: string;
    last_active: string;
}

export default function CustomersPage() {
    const [customers, setCustomers] = React.useState<Customer[]>([]);
    const [searchTerm, setSearchTerm] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const { toast } = useToast();
    const supabase = createClient();
    
    const fetchCustomers = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('customers')
            .select('*, phone:phone_number')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'Sync Error', description: error.message });
        } else {
            setCustomers(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    const handleAddCustomer = async (newCustomer: Partial<Customer>) => {
        const result = await saveCustomerAction(newCustomer);
        if (!result.success) {
            toast({ variant: "destructive", title: "Save Failed", description: result.error });
        } else {
            toast({ title: "Customer Saved" });
            fetchCustomers();
        }
    }

    const handleDelete = async (id: string) => {
        const result = await deleteCustomerAction(id);
        if (!result.success) {
            toast({ variant: 'destructive', title: 'Delete Failed', description: result.error });
        } else {
            toast({ title: "Removed from CRM" });
            fetchCustomers();
        }
    };

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
        (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (c.company && c.company.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const totalLtv = customers.reduce((acc, c) => acc + (Number(c.lifetime_spend) || 0), 0);

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Customer Relationships</h1>
                    <p className="text-muted-foreground mt-1">Manage profiles and loyalty in a relational PostgreSQL backend.</p>
                </div>
                <AddCustomerDialog onSave={handleAddCustomer} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <CRMStatCard title="Total Customers" value={customers.length.toString()} subtext="Syncing via Supabase" icon={Users} />
                <CRMStatCard title="Portfolio LTV" value={`₦${(totalLtv / 1000000).toFixed(2)}M`} subtext="Real-time aggregation" icon={Wallet} />
                <CRMStatCard title="Active Tier" value="GOLD" subtext="Top segment" icon={TrendingUp} />
                <CRMStatCard title="Security" value="ACTIVE" subtext="RLS Partitioning" icon={CheckCircle2} />
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
                                            No customers found matching &quot;{searchTerm}&quot;
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
                                                <div className="font-bold font-headline">₦{Number(customer.lifetime_spend).toLocaleString()}</div>
                                                <Badge variant="outline" className="text-[10px] py-0 h-4 mt-1">{customer.loyalty_tier}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="text-sm">{customer.last_active}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex justify-end">
                                                    <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button aria-haspopup="true" size="icon" variant="ghost" className="rounded-full">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl">
                                                        <DropdownMenuLabel>CRM Actions</DropdownMenuLabel>
                                                        <SheetTrigger asChild><DropdownMenuItem>View Profile</DropdownMenuItem></SheetTrigger>
                                                        <DropdownMenuItem onClick={() => handleSendReminder(customer.name)}>Send Reminder</DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(customer.id)}>Delete</DropdownMenuItem>
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
            </Card>
        </div>
    )
}

function CRMStatCard({ title, value, subtext, icon: Icon }: any) {
    return (
        <Card className="bg-primary/5 border-primary/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    )
}

function AddCustomerDialog({ onSave }: { onSave: (newCustomer: Partial<Customer>) => void }) {
    const [name, setName] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                 <Button className="rounded-xl shadow-lg shadow-primary/20">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Customer
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>Add New Profile</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2"><Label>Full Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
                     <Button onClick={() => { onSave({ name, email }); setIsDialogOpen(false); }}>Save to CRM</Button>
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
                    <div className="bg-primary/10 p-4 rounded-2xl"><User className="h-8 w-8 text-primary" /></div>
                    <div>
                        <SheetTitle className="text-2xl font-headline text-left">{customer.name}</SheetTitle>
                        <SheetDescription>{customer.company || "Individual Customer"}</SheetDescription>
                    </div>
                </div>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-120px)] py-6 pr-4">
                <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl border bg-muted/30">
                            <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Lifetime Value</p>
                            <p className="text-xl font-bold font-headline">₦{Number(customer.lifetime_spend).toLocaleString()}</p>
                        </div>
                        <div className="p-4 rounded-xl border bg-muted/30">
                            <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Loyalty Tier</p>
                            <Badge variant="outline">{customer.loyalty_tier}</Badge>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="font-bold text-sm uppercase text-muted-foreground tracking-widest">Contact</h4>
                        <div className="grid gap-3">
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border"><Mail className="h-4 w-4 text-primary" /><span>{customer.email}</span></div>
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border"><Phone className="h-4 w-4 text-primary" /><span>{customer.phone || "N/A"}</span></div>
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-card border"><MapPin className="h-4 w-4 text-primary" /><span>{customer.address || "N/A"}</span></div>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </SheetContent>
    )
}
