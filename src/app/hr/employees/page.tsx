
"use client"
import * as React from "react"
import { 
    MoreHorizontal, 
    PlusCircle, 
    UserCog, 
    Trash2, 
    Edit2, 
    User, 
    Mail, 
    ShieldCheck, 
    Phone, 
    Briefcase,
    Banknote,
    Fingerprint,
    CreditCard,
    Building2,
    Search
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { employees as initialEmployees } from "@/lib/data"
import type { Employee } from "@/lib/data"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import Link from "next/link"

export default function EmployeesPage() {
    const { toast } = useToast()
    const [employees, setEmployees] = React.useState<Employee[]>(initialEmployees)
    const [searchTerm, setSearchTerm] = React.useState("")
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [isEditOpen, setIsEditOpen] = React.useState(false)
    const [selectedEmployee, setSelectedEmployee] = React.useState<Employee | null>(null)
    
    const [formData, setFormData] = React.useState<Partial<Employee>>({
        name: '',
        email: '',
        role: '',
        status: 'Active',
        baseSalary: 0,
        bankName: '',
        accountNumber: '',
        pensionId: ''
    })

    const filteredEmployees = employees.filter(e => 
        e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.role.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const handleAddEmployee = () => {
        if (!formData.name || !formData.email) {
            toast({ variant: "destructive", title: "Missing Info", description: "Name and email are required." })
            return
        }
        
        const newEmployee: Employee = {
            id: `emp-${Date.now()}`,
            name: formData.name!,
            email: formData.email!,
            role: formData.role || 'General Staff',
            status: (formData.status as any) || 'Active',
            baseSalary: formData.baseSalary || 0,
            bankName: formData.bankName,
            accountNumber: formData.accountNumber,
            pensionId: formData.pensionId
        }

        setEmployees([newEmployee, ...employees])
        setIsAddOpen(false)
        resetForm()
        toast({ title: "Employee Onboarded", description: `${newEmployee.name} has been added to the database.` })
    }

    const handleUpdateEmployee = () => {
        if (!selectedEmployee || !formData.name) return
        
        setEmployees(employees.map(e => 
            e.id === selectedEmployee.id ? { ...e, ...formData } as Employee : e
        ))
        setIsEditOpen(false)
        setSelectedEmployee(null)
        resetForm()
        toast({ title: "Profile Updated", description: `Changes for ${formData.name} saved successfully.` })
    }

    const handleDeleteEmployee = (id: string) => {
        const emp = employees.find(e => e.id === id)
        setEmployees(employees.filter(e => e.id !== id))
        toast({ title: "Employee Removed", description: `${emp?.name} has been deleted from records.` })
    }

    const openEdit = (employee: Employee) => {
        setSelectedEmployee(employee)
        setFormData(employee)
        setIsEditOpen(true)
    }

    const resetForm = () => {
        setFormData({ name: '', email: '', role: '', status: 'Active', baseSalary: 0, bankName: '', accountNumber: '', pensionId: '' })
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Employee Database</h1>
                    <p className="text-muted-foreground mt-1">Manage team profiles, roles, and compensation structures.</p>
                </div>
                
                <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if(open) resetForm(); }}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-lg shadow-primary/20">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add New Hire
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle className="font-headline text-xl">Onboard Team Member</DialogTitle>
                            <DialogDescription>Create a professional profile and set initial salary.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Full Name</Label>
                                    <Input id="name" placeholder="Samuel Okoro" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Work Email</Label>
                                    <Input id="email" type="email" placeholder="s.okoro@company.com" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="role">Job Title</Label>
                                    <Input id="role" placeholder="Sales Lead" value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="salary">Gross Salary (₦)</Label>
                                    <Input id="salary" type="number" placeholder="250000" value={formData.baseSalary || ""} onChange={(e) => setFormData({...formData, baseSalary: parseFloat(e.target.value) || 0})} />
                                </div>
                            </div>
                            <Separator className="my-2" />
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="bank">Bank Name</Label>
                                    <Input id="bank" placeholder="e.g. Sterling Bank" value={formData.bankName} onChange={(e) => setFormData({...formData, bankName: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="account">Account Number</Label>
                                    <Input id="account" placeholder="0012345678" value={formData.accountNumber} onChange={(e) => setFormData({...formData, accountNumber: e.target.value})} />
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                            <Button onClick={handleAddEmployee}>Launch Profile</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <CardTitle className="font-headline">Organizational Directory</CardTitle>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search by name, email or role..." 
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
                                    <TableHead className="w-[300px]">Employee</TableHead>
                                    <TableHead className="hidden sm:table-cell">Role</TableHead>
                                    <TableHead className="hidden md:table-cell">Monthly Gross</TableHead>
                                    <TableHead className="hidden lg:table-cell text-center">Status</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredEmployees.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center text-muted-foreground italic">
                                            No employees found matching your search.
                                        </TableCell>
                                    </TableRow>
                                ) : filteredEmployees.map(employee => (
                                    <Sheet key={employee.id}>
                                        <TableRow className="hover:bg-primary/5 transition-colors group">
                                            <TableCell>
                                                <SheetTrigger asChild>
                                                    <div className="flex items-center gap-3 cursor-pointer">
                                                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase group-hover:bg-primary group-hover:text-white transition-all">
                                                            {employee.name.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-sm group-hover:text-primary transition-colors">{employee.name}</span>
                                                            <span className="text-xs text-muted-foreground">{employee.email}</span>
                                                        </div>
                                                    </div>
                                                </SheetTrigger>
                                            </TableCell>
                                            <TableCell className="hidden sm:table-cell">
                                                <div className="text-sm font-medium flex items-center gap-2">
                                                    <ShieldCheck className="h-3 w-3 text-muted-foreground" />
                                                    {employee.role}
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell font-mono">
                                                ₦{employee.baseSalary.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="hidden lg:table-cell text-center">
                                                <Badge 
                                                    variant={employee.status === "Active" ? "default" : "secondary"}
                                                    className={cn(
                                                        "text-[10px] uppercase font-bold",
                                                        employee.status === 'Active' && "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                                                    )}
                                                >
                                                    {employee.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="rounded-full">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl w-48">
                                                        <DropdownMenuLabel>Member Actions</DropdownMenuLabel>
                                                        <SheetTrigger asChild>
                                                            <DropdownMenuItem><UserCog className="h-4 w-4 mr-2" /> View Detailed Profile</DropdownMenuItem>
                                                        </SheetTrigger>
                                                        <DropdownMenuItem onClick={() => openEdit(employee)}>
                                                            <Edit2 className="h-4 w-4 mr-2" /> Adjust Salary/Role
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem asChild>
                                                            <Link href="/hr/termination">
                                                                <Trash2 className="h-4 w-4 mr-2" /> Process Exit
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            className="text-destructive"
                                                            onClick={() => handleDeleteEmployee(employee.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" /> Delete Record
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>

                                        <SheetContent className="sm:max-w-xl">
                                            <SheetHeader className="border-b pb-6">
                                                <div className="flex items-center gap-4 text-left">
                                                    <div className="bg-primary/10 p-4 rounded-2xl">
                                                        <User className="h-8 w-8 text-primary" />
                                                    </div>
                                                    <div>
                                                        <SheetTitle className="text-2xl font-headline">{employee.name}</SheetTitle>
                                                        <SheetDescription>{employee.role} • Employee ID: {employee.id}</SheetDescription>
                                                    </div>
                                                </div>
                                            </SheetHeader>
                                            <ScrollArea className="h-[calc(100vh-120px)] py-8 pr-4">
                                                <div className="space-y-8">
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="p-4 rounded-xl border bg-muted/30">
                                                            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Gross Salary</p>
                                                            <p className="text-xl font-bold font-headline">₦{employee.baseSalary.toLocaleString()}</p>
                                                        </div>
                                                        <div className="p-4 rounded-xl border bg-muted/30">
                                                            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Current Status</p>
                                                            <Badge variant="outline" className="mt-1">{employee.status}</Badge>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4">
                                                        <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Compensation & Compliance</h4>
                                                        <div className="grid gap-3">
                                                            <div className="flex items-center gap-3 text-sm p-3 rounded-lg border bg-card">
                                                                <Banknote className="h-4 w-4 text-primary" />
                                                                <div className="flex-1">
                                                                    <p className="font-medium">{employee.bankName || "No Bank Linked"}</p>
                                                                    <p className="text-[10px] text-muted-foreground">Account: {employee.accountNumber || "N/A"}</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-sm p-3 rounded-lg border bg-card">
                                                                <Fingerprint className="h-4 w-4 text-primary" />
                                                                <div className="flex-1">
                                                                    <p className="font-medium">Pension ID (RSA)</p>
                                                                    <p className="text-[10px] text-muted-foreground">{employee.pensionId || "Pending Verification"}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4 pt-6 border-t">
                                                        <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Internal Actions</h4>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <Button variant="outline" asChild className="justify-start gap-2 h-auto py-3">
                                                                <Link href="/hr/payroll">
                                                                    <CreditCard className="h-4 w-4" /> View Payslips
                                                                </Link>
                                                            </Button>
                                                            <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => openEdit(employee)}>
                                                                <Edit2 className="h-4 w-4" /> Adjust Profile
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </ScrollArea>
                                        </SheetContent>
                                    </Sheet>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-headline text-xl">Modify Employee Profile</DialogTitle>
                        <DialogDescription>Update professional details for {selectedEmployee?.name}.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label>Job Title</Label>
                            <Input value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                            <Label>Monthly Gross Salary (₦)</Label>
                            <Input type="number" value={formData.baseSalary || ""} onChange={(e) => setFormData({...formData, baseSalary: parseFloat(e.target.value) || 0})} />
                        </div>
                        <div className="space-y-2">
                            <Label>Bank Name</Label>
                            <Input value={formData.bankName} onChange={(e) => setFormData({...formData, bankName: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                            <Label>Account Number</Label>
                            <Input value={formData.accountNumber} onChange={(e) => setFormData({...formData, accountNumber: e.target.value})} />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <Button onClick={handleUpdateEmployee}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
