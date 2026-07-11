"use client"
import * as React from "react"
import { MoreHorizontal, PlusCircle, UserCog, Trash2, Edit2, User, Mail, ShieldCheck, Phone, Briefcase } from "lucide-react"
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
import { employees as initialEmployees } from "@/lib/data"
import type { Employee } from "@/lib/data"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function EmployeesPage() {
    const { toast } = useToast()
    const [employees, setEmployees] = React.useState<Employee[]>(initialEmployees)
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [isEditOpen, setIsEditOpen] = React.useState(false)
    const [selectedEmployee, setSelectedEmployee] = React.useState<Employee | null>(null)
    
    const [formData, setFormData] = React.useState<Partial<Employee>>({
        name: '',
        email: '',
        role: '',
        status: 'Active'
    })

    const handleAddEmployee = () => {
        if (!formData.name || !formData.email) {
            toast({ variant: "destructive", title: "Missing Info", description: "Name and email are required." })
            return
        }
        
        const newEmployee: Employee = {
            id: `emp-${Date.now()}`,
            name: formData.name,
            email: formData.email,
            role: formData.role || 'General Staff',
            status: formData.status as any || 'Active'
        }

        setEmployees([newEmployee, ...employees])
        setIsAddOpen(false)
        setFormData({ name: '', email: '', role: '', status: 'Active' })
        toast({ title: "Employee Onboarded", description: `${newEmployee.name} has been added to the database.` })
    }

    const handleUpdateRole = () => {
        if (!selectedEmployee || !formData.role) return
        
        setEmployees(employees.map(e => 
            e.id === selectedEmployee.id ? { ...e, role: formData.role! } : e
        ))
        setIsEditOpen(false)
        setSelectedEmployee(null)
        toast({ title: "Role Updated", description: `Updated position for ${selectedEmployee.name}.` })
    }

    const updateStatus = (id: string, status: Employee['status']) => {
        setEmployees(employees.map(e => e.id === id ? { ...e, status } : e))
        toast({ 
            title: status === 'Terminated' ? "Employee Terminated" : "Status Updated", 
            description: `Employee profile is now ${status}.` 
        })
    }

    const openEdit = (employee: Employee) => {
        setSelectedEmployee(employee)
        setFormData({ role: employee.role })
        setIsEditOpen(true)
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Employee Database</h1>
                    <p className="text-muted-foreground mt-1">Manage team profiles, roles, and organizational structure.</p>
                </div>
                
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-lg shadow-primary/20">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add New Hire
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="font-headline text-xl">Onboard Team Member</DialogTitle>
                            <DialogDescription>Create a professional profile for a new employee.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input 
                                    id="name" 
                                    placeholder="e.g. Samuel Okoro" 
                                    value={formData.name} 
                                    onChange={(e) => setFormData({...formData, name: e.target.value})} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Work Email</Label>
                                <Input 
                                    id="email" 
                                    type="email" 
                                    placeholder="s.okoro@company.com" 
                                    value={formData.email} 
                                    onChange={(e) => setFormData({...formData, email: e.target.value})} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">Job Title</Label>
                                <Input 
                                    id="role" 
                                    placeholder="e.g. Sales Lead" 
                                    value={formData.role} 
                                    onChange={(e) => setFormData({...formData, role: e.target.value})} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="status">Initial Status</Label>
                                <Select 
                                    value={formData.status} 
                                    onValueChange={(val: any) => setFormData({...formData, status: val})}
                                >
                                    <SelectTrigger id="status">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Active">Active</SelectItem>
                                        <SelectItem value="On Probation">On Probation</SelectItem>
                                    </SelectContent>
                                </Select>
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
                    <CardTitle className="font-headline">Organizational Directory</CardTitle>
                    <CardDescription>A list of all team members currently within your business ecosystem.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="w-[300px]">Employee</TableHead>
                                    <TableHead className="hidden sm:table-cell">Role</TableHead>
                                    <TableHead className="hidden md:table-cell">Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map(employee => (
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
                                            <TableCell className="hidden md:table-cell">
                                                <Badge 
                                                    variant={employee.status === "Active" ? "default" : employee.status === "On Probation" ? "secondary" : "destructive"}
                                                    className={cn(
                                                        employee.status === "Active" ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20" : 
                                                        employee.status === "On Probation" ? "bg-amber-400/10 text-amber-700" : ""
                                                    )}
                                                >
                                                    {employee.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="rounded-full">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                            <span className="sr-only">Toggle menu</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl w-48">
                                                        <DropdownMenuLabel>Member Actions</DropdownMenuLabel>
                                                        <SheetTrigger asChild>
                                                            <DropdownMenuItem><UserCog className="h-4 w-4 mr-2" /> View Detailed Profile</DropdownMenuItem>
                                                        </SheetTrigger>
                                                        <DropdownMenuItem onClick={() => openEdit(employee)}>
                                                            <Edit2 className="h-4 w-4 mr-2" /> Adjust Role
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        {employee.status !== 'Terminated' ? (
                                                            <DropdownMenuItem 
                                                                className="text-destructive focus:bg-destructive/10 focus:text-destructive" 
                                                                onClick={() => updateStatus(employee.id, 'Terminated')}
                                                            >
                                                                <Trash2 className="h-4 w-4 mr-2" /> Terminate Employment
                                                            </DropdownMenuItem>
                                                        ) : (
                                                            <DropdownMenuItem 
                                                                className="text-emerald-600 focus:bg-emerald-50" 
                                                                onClick={() => updateStatus(employee.id, 'Active')}
                                                            >
                                                                <PlusCircle className="h-4 w-4 mr-2" /> Reinstate Profile
                                                            </DropdownMenuItem>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>

                                        <SheetContent className="sm:max-w-md">
                                            <SheetHeader className="border-b pb-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="bg-primary/10 p-4 rounded-2xl">
                                                        <User className="h-8 w-8 text-primary" />
                                                    </div>
                                                    <div>
                                                        <SheetTitle className="text-2xl font-headline">{employee.name}</SheetTitle>
                                                        <SheetDescription className="flex items-center gap-2">
                                                            ID: <span className="font-mono text-[10px] uppercase font-bold text-primary">{employee.id}</span>
                                                        </SheetDescription>
                                                    </div>
                                                </div>
                                            </SheetHeader>
                                            <div className="py-8 space-y-8">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="p-4 rounded-xl border bg-muted/30">
                                                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Current Role</p>
                                                        <p className="text-sm font-bold">{employee.role}</p>
                                                    </div>
                                                    <div className="p-4 rounded-xl border bg-muted/30">
                                                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Status</p>
                                                        <Badge variant="outline" className="mt-1">{employee.status}</Badge>
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Contact Information</h4>
                                                    <div className="grid gap-3">
                                                        <div className="flex items-center gap-3 text-sm p-3 rounded-lg border bg-card">
                                                            <Mail className="h-4 w-4 text-primary" />
                                                            <span className="font-medium">{employee.email}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3 text-sm p-3 rounded-lg border bg-card">
                                                            <Phone className="h-4 w-4 text-primary" />
                                                            <span className="font-medium">+234 800 000 0000</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-4 pt-6 border-t">
                                                    <h4 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Quick Profile Actions</h4>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <Button variant="outline" className="justify-start gap-2 h-auto py-3">
                                                            <Mail className="h-4 w-4" /> Send Email
                                                        </Button>
                                                        <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => openEdit(employee)}>
                                                            <Briefcase className="h-4 w-4" /> Update Role
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
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
                        <DialogTitle className="font-headline">Adjust Job Details</DialogTitle>
                        <DialogDescription>Modify the role and title for {selectedEmployee?.name}.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-role">New Job Title</Label>
                            <Input 
                                id="edit-role" 
                                value={formData.role} 
                                onChange={(e) => setFormData({...formData, role: e.target.value})} 
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <Button onClick={handleUpdateRole}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
