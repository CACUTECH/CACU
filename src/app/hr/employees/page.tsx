"use client"
import * as React from "react"
import { MoreHorizontal, PlusCircle, UserCog, Trash2, Edit2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { employees as initialEmployees } from "@/lib/data"
import type { Employee } from "@/lib/data"
import { useToast } from "@/hooks/use-toast"

export default function EmployeesPage() {
    const { toast } = useToast()
    const [employees, setEmployees] = React.useState<Employee[]>(initialEmployees)
    const [isAddOpen, setIsAddOpen] = React.useState(false)
    const [formData, setFormData] = React.useState<Partial<Employee>>({
        name: '',
        email: '',
        role: '',
        status: 'Active'
    })

    const handleAddEmployee = () => {
        if (!formData.name || !formData.email) return
        
        const newEmployee: Employee = {
            id: `emp-${Date.now()}`,
            name: formData.name,
            email: formData.email,
            role: formData.role || 'General Staff',
            status: formData.status as any || 'Active'
        }

        setEmployees([...employees, newEmployee])
        setIsAddOpen(false)
        setFormData({ name: '', email: '', role: '', status: 'Active' })
        toast({ title: "Employee Added", description: `${newEmployee.name} is now in your database.` })
    }

    const updateStatus = (id: string, status: Employee['status']) => {
        setEmployees(employees.map(e => e.id === id ? { ...e, status } : e))
        toast({ title: "Status Updated", description: "Employee status has been changed." })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="font-headline">Employee Database</CardTitle>
                        <CardDescription>Manage your employee profiles and statuses.</CardDescription>
                    </div>
                    
                    <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Employee
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add New Employee</DialogTitle>
                                <DialogDescription>Enter professional details for the new team member.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label>Full Name</Label>
                                    <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Email Address</Label>
                                    <Input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Job Role</Label>
                                    <Input value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value})} />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                                <Button onClick={handleAddEmployee}>Create Profile</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead className="hidden sm:table-cell">Role</TableHead>
                            <TableHead className="hidden md:table-cell">Status</TableHead>
                            <TableHead>
                            <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                            {employees.map(employee => (
                                <TableRow key={employee.id}>
                                    <TableCell>
                                        <div className="font-medium">{employee.name}</div>
                                        <div className="text-sm text-muted-foreground">{employee.email}</div>
                                    </TableCell>
                                     <TableCell className="hidden sm:table-cell">
                                        <div className="font-medium">{employee.role}</div>
                                     </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <Badge 
                                            variant={employee.status === "Active" ? "default" : employee.status === "On Probation" ? "secondary" : "destructive"}
                                            className={employee.status === "Active" ? "bg-green-500/20 text-green-700" : employee.status === "On Probation" ? "bg-yellow-400/20 text-yellow-600" : ""}
                                        >
                                            {employee.status}
                                        </Badge>
                                    </TableCell>
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
                                                <DropdownMenuItem><UserCog className="h-4 w-4 mr-2" /> View Profile</DropdownMenuItem>
                                                <DropdownMenuItem><Edit2 className="h-4 w-4 mr-2" /> Edit Role</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem 
                                                    className="text-destructive" 
                                                    onClick={() => updateStatus(employee.id, 'Terminated')}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" /> Terminate
                                                </DropdownMenuItem>
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
        </Card>
    )
}
