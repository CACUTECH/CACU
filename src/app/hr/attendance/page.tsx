
"use client"

import * as React from "react"
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle,
    CardFooter
} from "@/components/ui/card"
import { 
    Table, 
    TableBody, 
    TableCell, 
    TableHead, 
    TableHeader, 
    TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
    Clock, 
    LogOut, 
    CheckCircle2, 
    TrendingUp, 
    Users, 
    Timer,
    MapPin,
    ArrowUpRight,
    Search,
    Loader2,
    Download
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { format, parseISO, differenceInMinutes } from "date-fns"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useSupabaseUser } from "@/hooks/use-supabase-user"
import { logAttendanceAction } from "./actions"

type AttendanceRecord = {
    id: string;
    employee_id: string;
    check_in: string;
    check_out?: string;
    employees: {
        name: string;
        role: string;
    };
}

export default function AttendancePage() {
    const { user } = useSupabaseUser();
    const supabase = createClient();
    const { toast } = useToast();
    
    const [records, setRecords] = React.useState<AttendanceRecord[]>([]);
    const [staffList, setStaffList] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [isProcessing, setIsProcessing] = React.useState<string | null>(null);
    const [searchTerm, setSearchTerm] = React.useState("");

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        
        const [attRes, staffRes] = await Promise.all([
            supabase.from('attendance').select('*, employees(name:full_name, role:job_title)').gte('check_in', `${today}T00:00:00`),
            supabase.from('employees').select('id, name:full_name, role:job_title').eq('employment_status', 'Active')
        ]);

        if (!attRes.error) setRecords(attRes.data || []);
        if (!staffRes.error) setStaffList(staffRes.data || []);
        setLoading(false);
    }, [supabase]);

    React.useEffect(() => {
        if (user) fetchData();
    }, [user, fetchData]);

    const handleLog = async (id: string, type: 'IN' | 'OUT') => {
        setIsProcessing(id);
        const res = await logAttendanceAction(id, type);
        if (res.success) {
            toast({ title: type === 'IN' ? "Check-in Recorded" : "Check-out Recorded" });
            fetchData();
        } else {
            toast({ variant: "destructive", title: "Action Failed", description: res.error });
        }
        setIsProcessing(null);
    };

    const filteredStaff = staffList.filter(s => 
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Workforce Tracking</h1>
                <p className="text-muted-foreground mt-1">Live monitoring of team attendance linked to relational personnel records.</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Present Today" value={records.length.toString()} icon={Users} />
                <StatCard title="Total Staff" value={staffList.length.toString()} icon={Timer} />
            </div>

            <Card className="shadow-xl border-primary/10 overflow-hidden">
                <CardHeader className="bg-muted/20 border-b">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="font-headline">Live Attendance Sheet</CardTitle>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search staff..." className="pl-9 rounded-xl" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="pl-6">Employee</TableHead>
                                <TableHead className="text-center">Check-in</TableHead>
                                <TableHead className="text-center">Check-out</TableHead>
                                <TableHead className="text-right pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredStaff.map((staff) => {
                                const record = records.find(r => r.employee_id === staff.id);
                                return (
                                    <TableRow key={staff.id} className="hover:bg-primary/5 transition-colors">
                                        <TableCell className="pl-6 font-bold">
                                            {staff.name}
                                            <div className="text-[10px] text-muted-foreground font-normal uppercase">{staff.role}</div>
                                        </TableCell>
                                        <TableCell className="text-center font-mono text-sm">
                                            {record?.check_in ? format(parseISO(record.check_in), "hh:mm a") : "--:--"}
                                        </TableCell>
                                        <TableCell className="text-center font-mono text-sm">
                                            {record?.check_out ? format(parseISO(record.check_out), "hh:mm a") : "--:--"}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            {!record ? (
                                                <Button size="sm" onClick={() => handleLog(staff.id, 'IN')} disabled={isProcessing === staff.id}>
                                                    {isProcessing === staff.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Check In"}
                                                </Button>
                                            ) : !record.check_out ? (
                                                <Button size="sm" variant="outline" onClick={() => handleLog(staff.id, 'OUT')} disabled={isProcessing === staff.id}>
                                                    {isProcessing === staff.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Check Out"}
                                                </Button>
                                            ) : (
                                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700">Completed</Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}

function StatCard({ title, value, icon: Icon }: any) {
    return (
        <Card className="bg-primary/5 border-primary/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold font-headline">{value}</div></CardContent>
        </Card>
    )
}
