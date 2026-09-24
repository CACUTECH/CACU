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
    Loader2,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { collection, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { useFirestore, useUser, useCollection } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type Employee = {
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'Active' | 'On Probation' | 'Terminated' | 'On Notice';
    baseSalary: number;
}

export default function EmployeesPage() {
    const { user } = useUser();
    const db = useFirestore();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = React.useState("");

    // Context Loading
    const businessId = user?.uid;
    const empRef = businessId ? collection(db, 'businesses', businessId, 'employees') : null;
    const empQuery = empRef ? query(empRef, orderBy('name')) : null;
    const { data: employees, loading } = useCollection<Employee>(empQuery);

    const handleSaveEmployee = (emp: Partial<Employee>) => {
        if (!businessId || !empRef) return;
        const id = emp.id || `emp-${Date.now()}`;
        const docRef = doc(empRef, id);
        const data = { ...emp, id };

        setDoc(docRef, data, { merge: true })
            .then(() => toast({ title: emp.id ? "Profile Updated" : "Employee Added" }))
            .catch(async (e) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: 'write',
                    requestResourceData: data,
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    };

    const handleDeleteEmployee = (id: string) => {
        if (!businessId || !empRef) return;
        const docRef = doc(empRef, id);
        deleteDoc(docRef)
            .then(() => toast({ title: "Employee Record Removed" }))
            .catch(async (e) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: 'delete',
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Employees</h1>
                    <p className="text-muted-foreground">Secure cloud storage for personnel records.</p>
                </div>
                <AddEmployeeDialog onSave={handleSaveEmployee} />
            </div>

            <Card>
                <CardHeader>
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search team..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Salary</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees?.map((emp) => (
                                    <TableRow key={emp.id}>
                                        <TableCell className="font-bold">{emp.name}</TableCell>
                                        <TableCell>{emp.role}</TableCell>
                                        <TableCell>₦{emp.baseSalary.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleDeleteEmployee(emp.id)} className="text-destructive">Delete Record</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function AddEmployeeDialog({ onSave }: { onSave: (emp: Partial<Employee>) => void }) {
    const [name, setName] = React.useState('');
    const [role, setRole] = React.useState('');
    const [salary, setSalary] = React.useState('0');

    return (
        <Dialog>
            <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Add Hire</Button></DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>New Employee Record</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2"><Label>Full Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Job Title</Label><Input value={role} onChange={(e) => setRole(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Monthly Gross (₦)</Label><Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button onClick={() => onSave({ name, role, baseSalary: parseFloat(salary), status: 'Active', email: `${name.toLowerCase().replace(' ', '.')}@company.com` })}>
                            Create Profile
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}