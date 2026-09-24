
"use client"
import * as React from "react"
import { 
    PlusCircle, 
    Loader2
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { useSupabaseUser } from "@/hooks/use-supabase-user"
import { addEmployeeAction } from "./actions"

type Employee = {
    id: string;
    name: string;
    email: string;
    role: string;
    department: string;
    status: string;
    base_salary: number;
}

export default function EmployeesPage() {
    const { user } = useSupabaseUser();
    const supabase = createClient();
    const { toast } = useToast();
    const [employees, setEmployees] = React.useState<Employee[]>([]);
    const [loading, setLoading] = React.useState(true);

    const fetchStaff = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('employees')
            .select('*')
            .order('name');
        
        if (error) {
            toast({ variant: 'destructive', title: 'HR Sync Error', description: error.message });
        } else {
            setEmployees(data || []);
        }
        setLoading(false);
    }, [supabase, toast]);

    React.useEffect(() => {
        if (user) fetchStaff();
    }, [user, fetchStaff]);

    const handleSaveEmployee = async (emp: Partial<Employee>) => {
        const result = await addEmployeeAction(emp);
        if (!result.success) {
            toast({ variant: 'destructive', title: 'HR Error', description: result.error });
        } else {
            toast({ title: "New Hire Added" });
            fetchStaff();
        }
    };

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Personnel Records</h1>
                    <p className="text-muted-foreground text-sm">Secure records managed via HRService.</p>
                </div>
                <AddEmployeeDialog onSave={handleSaveEmployee} />
            </div>

            <Card className="shadow-xl border-primary/5">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="pl-6">Name</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Department</TableHead>
                                <TableHead className="text-right pr-6">Base Salary</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {employees.map((emp) => (
                                <TableRow key={emp.id} className="hover:bg-primary/5 transition-colors">
                                    <TableCell className="pl-6 font-bold">{emp.name}</TableCell>
                                    <TableCell className="text-sm">{emp.role}</TableCell>
                                    <TableCell><Badge variant="outline">{emp.department || 'General'}</Badge></TableCell>
                                    <TableCell className="text-right pr-6 font-mono">₦{Number(emp.base_salary).toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                            {employees.length === 0 && (
                                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic">No team members registered yet.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
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
                <DialogHeader><DialogTitle>Initialize Employee Profile</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2"><Label>Full Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Job Title</Label><Input value={role} onChange={(e) => setRole(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Monthly Gross (₦)</Label><Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button onClick={() => onSave({ name, role, base_salary: parseFloat(salary), status: 'Active' })}>
                            Create Profile
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
