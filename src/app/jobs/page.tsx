"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
    PlusCircle, 
    Search, 
    Filter, 
    Wrench, 
    Clock, 
    User, 
    ArrowRight, 
    ClipboardCheck, 
    AlertCircle,
    CheckCircle2,
    Calendar as CalendarIcon
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { jobs as initialJobs, employees } from "@/lib/data"
import type { Job, JobStatus } from "@/lib/data"
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle, 
    DialogTrigger,
    DialogClose 
} from "@/components/ui/dialog"
import { 
    Sheet, 
    SheetContent, 
    SheetDescription, 
    SheetHeader, 
    SheetTitle, 
    SheetTrigger 
} from "@/components/ui/sheet"
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { format, isBefore, parseISO, startOfDay } from "date-fns"

export default function JobsPage() {
    const { toast } = useToast()
    const [searchTerm, setSearchTerm] = React.useState("")
    const [jobsList, setJobsList] = React.useState<Job[]>(initialJobs)
    const [isCreateOpen, setIsCreateOpen] = React.useState(false)

    // Form State for New Job
    const [newJob, setNewJob] = React.useState<Partial<Job>>({
        title: "",
        customerName: "",
        description: "",
        priority: "Medium",
        assignedStaffId: "",
        dueDate: format(new Date(), "yyyy-MM-dd")
    })

    const filteredJobs = jobsList.filter(job => 
        job.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
        job.customerName.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Dynamic Summary Calculations
    const activeJobs = jobsList.filter(j => j.status !== 'Completed' && j.status !== 'Cancelled').length
    const readyForInvoice = jobsList.filter(j => j.status === 'Completed').length
    const totalPotentialRevenue = jobsList.filter(j => j.status === 'Completed').reduce((acc, curr) => acc + curr.totalAmount, 0)
    const overdueJobs = jobsList.filter(j => {
        const isPastDue = isBefore(parseISO(j.dueDate), startOfDay(new Date()))
        return isPastDue && j.status !== 'Completed' && j.status !== 'Cancelled'
    }).length

    const getStatusStyles = (status: JobStatus) => {
        switch(status) {
            case 'Completed': return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
            case 'In Progress': return "bg-blue-500/10 text-blue-700 border-blue-500/20";
            case 'Assigned': return "bg-indigo-500/10 text-indigo-700 border-indigo-500/20";
            case 'Pending': return "bg-amber-500/10 text-amber-700 border-amber-500/20";
            case 'Cancelled': return "bg-red-500/10 text-red-700 border-red-500/20";
            default: return "bg-slate-500/10 text-slate-700 border-slate-500/20";
        }
    }

    const handleCreateJob = () => {
        if (!newJob.title || !newJob.customerName) {
            toast({
                variant: "destructive",
                title: "Missing Information",
                description: "Title and Customer Name are required."
            })
            return
        }

        const job: Job = {
            id: `job-${Date.now()}`,
            title: newJob.title!,
            customerName: newJob.customerName!,
            description: newJob.description || "",
            status: "Assigned",
            priority: newJob.priority as any || "Medium",
            assignedStaffId: newJob.assignedStaffId,
            dueDate: newJob.dueDate!,
            createdAt: format(new Date(), "yyyy-MM-dd"),
            totalAmount: 0 // In a real app, this might come from the assigned services
        }

        setJobsList([job, ...jobsList])
        setIsCreateOpen(false)
        setNewJob({ title: "", customerName: "", description: "", priority: "Medium", assignedStaffId: "", dueDate: format(new Date(), "yyyy-MM-dd") })
        
        toast({
            title: "Work Order Created",
            description: `${job.title} has been assigned to the board.`
        })
    }

    const updateJobStatus = (id: string, status: JobStatus) => {
        setJobsList(prev => prev.map(j => j.id === id ? { ...j, status } : j))
        toast({
            title: "Status Updated",
            description: `Job is now ${status}.`
        })
    }

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Work Orders & Jobs</h1>
                    <p className="text-muted-foreground mt-1">Track service delivery from assignment to completion.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => toast({ title: "Filters", description: "Filtering by staff or priority coming soon." })}>
                        <Filter className="mr-2 h-4 w-4" />
                        Filter
                    </Button>
                    
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="rounded-xl shadow-lg shadow-primary/20">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Create Work Order
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                                <DialogTitle className="font-headline text-xl">New Work Order</DialogTitle>
                                <DialogDescription>Define a new task for your team.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label>Job Title</Label>
                                    <Input 
                                        placeholder="e.g. Engine Diagnostic" 
                                        value={newJob.title}
                                        onChange={(e) => setNewJob({...newJob, title: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Customer Name</Label>
                                    <Input 
                                        placeholder="Enter customer name..." 
                                        value={newJob.customerName}
                                        onChange={(e) => setNewJob({...newJob, customerName: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Priority</Label>
                                        <Select value={newJob.priority} onValueChange={(val) => setNewJob({...newJob, priority: val as any})}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Low">Low</SelectItem>
                                                <SelectItem value="Medium">Medium</SelectItem>
                                                <SelectItem value="High">High</SelectItem>
                                                <SelectItem value="Urgent">Urgent</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Assign Staff</Label>
                                        <Select value={newJob.assignedStaffId} onValueChange={(val) => setNewJob({...newJob, assignedStaffId: val})}>
                                            <SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger>
                                            <SelectContent>
                                                {employees.map(e => (
                                                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Due Date</Label>
                                    <Input 
                                        type="date" 
                                        value={newJob.dueDate}
                                        onChange={(e) => setNewJob({...newJob, dueDate: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Internal Notes</Label>
                                    <Textarea 
                                        placeholder="Specific instructions for the team..." 
                                        value={newJob.description}
                                        onChange={(e) => setNewJob({...newJob, description: e.target.value})}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button onClick={handleCreateJob}>Launch Job</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-primary/5 border-primary/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Active Jobs</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">{activeJobs}</div>
                        <p className="text-[10px] text-muted-foreground mt-1">Ready for execution</p>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Awaiting Status</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">
                            {jobsList.filter(j => j.status === 'Pending').length}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">Require confirmation</p>
                    </CardContent>
                </Card>
                <Card className="bg-emerald-500/5 border-emerald-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Completed</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">{readyForInvoice}</div>
                        <p className="text-[10px] text-muted-foreground mt-1">₦{totalPotentialRevenue.toLocaleString()} realized value</p>
                    </CardContent>
                </Card>
                <Card className="bg-red-500/5 border-red-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Overdue</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline text-red-600">{overdueJobs}</div>
                        <p className="text-[10px] text-red-500 font-bold mt-1">Require urgent attention</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="shadow-xl shadow-primary/5 border-primary/10">
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="font-headline">Live Job Board</CardTitle>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search by customer or job title..." 
                                className="pl-9 rounded-xl border-primary/10 shadow-sm" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="pl-6 w-[300px]">Job Details</TableHead>
                                <TableHead>Assigned To</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Priority</TableHead>
                                <TableHead className="text-right pr-6">Amount</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredJobs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                        No work orders found matching your search.
                                    </TableCell>
                                </TableRow>
                            ) : filteredJobs.map((job) => {
                                const staff = employees.find(e => e.id === job.assignedStaffId);
                                const isPastDue = isBefore(parseISO(job.dueDate), startOfDay(new Date())) && job.status !== 'Completed';

                                return (
                                    <Sheet key={job.id}>
                                        <TableRow className="hover:bg-primary/5 transition-colors cursor-pointer group">
                                            <TableCell className="pl-6">
                                                <SheetTrigger asChild>
                                                    <div className="space-y-1">
                                                        <div className="font-bold text-sm group-hover:text-primary transition-colors">{job.title}</div>
                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <User className="h-3 w-3" /> {job.customerName}
                                                        </div>
                                                        <div className={cn(
                                                            "flex items-center gap-2 text-[10px] uppercase font-bold tracking-tighter mt-1",
                                                            isPastDue ? "text-red-600" : "text-muted-foreground"
                                                        )}>
                                                            <Clock className="h-3 w-3" /> Due {job.dueDate} {isPastDue && "(OVERDUE)"}
                                                        </div>
                                                    </div>
                                                </SheetTrigger>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                                                        {staff?.name.charAt(0) || '?'}
                                                    </div>
                                                    <span className="text-sm font-medium">{staff?.name || 'Unassigned'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={cn("text-[10px] uppercase", getStatusStyles(job.status))}>
                                                    {job.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1">
                                                    <div className={cn(
                                                        "w-2 h-2 rounded-full",
                                                        job.priority === 'Urgent' ? "bg-red-600 animate-pulse" :
                                                        job.priority === 'High' ? "bg-red-500" :
                                                        job.priority === 'Medium' ? "bg-amber-500" : "bg-slate-400"
                                                    )} />
                                                    <span className="text-xs font-medium">{job.priority}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <div className="font-mono font-bold">₦{job.totalAmount.toLocaleString()}</div>
                                            </TableCell>
                                            <TableCell>
                                                <SheetTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="rounded-full">
                                                        <ArrowRight className="h-4 w-4" />
                                                    </Button>
                                                </SheetTrigger>
                                            </TableCell>
                                        </TableRow>

                                        <SheetContent className="sm:max-w-lg">
                                            <SheetHeader className="border-b pb-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="bg-primary/10 p-4 rounded-2xl">
                                                        <Wrench className="h-8 w-8 text-primary" />
                                                    </div>
                                                    <div>
                                                        <SheetTitle className="text-2xl font-headline text-left">{job.title}</SheetTitle>
                                                        <SheetDescription className="flex items-center gap-2">
                                                            Customer: <strong>{job.customerName}</strong>
                                                        </SheetDescription>
                                                    </div>
                                                </div>
                                            </SheetHeader>
                                            <div className="py-6 space-y-6">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="p-4 rounded-xl border bg-muted/30">
                                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Status</p>
                                                        <Badge variant="outline" className={cn("text-[10px] uppercase", getStatusStyles(job.status))}>
                                                            {job.status}
                                                        </Badge>
                                                    </div>
                                                    <div className="p-4 rounded-xl border bg-muted/30">
                                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Priority</p>
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn(
                                                                "w-2 h-2 rounded-full",
                                                                job.priority === 'Urgent' ? "bg-red-600" : "bg-primary"
                                                            )} />
                                                            <span className="text-sm font-bold">{job.priority}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs uppercase font-bold text-muted-foreground">Timeline</Label>
                                                    <div className="grid gap-3">
                                                        <div className="flex items-center justify-between text-sm p-3 rounded-lg border bg-card">
                                                            <span className="flex items-center gap-2"><CalendarIcon className="h-4 w-4 text-primary" /> Created</span>
                                                            <span className="font-medium">{job.createdAt}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between text-sm p-3 rounded-lg border bg-card">
                                                            <span className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Due Date</span>
                                                            <span className={cn("font-medium", isPastDue ? "text-red-600 font-bold" : "")}>{job.dueDate}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs uppercase font-bold text-muted-foreground">Description</Label>
                                                    <p className="text-sm text-muted-foreground bg-muted/20 p-4 rounded-xl border italic">
                                                        {job.description || "No specific details provided for this work order."}
                                                    </p>
                                                </div>

                                                <div className="space-y-4 pt-4 border-t">
                                                    <Label className="text-xs uppercase font-bold text-muted-foreground">Quick Actions</Label>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <Button variant="outline" className="justify-start gap-2" onClick={() => updateJobStatus(job.id, 'In Progress')}>
                                                            <Clock className="h-4 w-4 text-blue-500" /> Mark In Progress
                                                        </Button>
                                                        <Button variant="outline" className="justify-start gap-2" onClick={() => updateJobStatus(job.id, 'Completed')}>
                                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Mark Completed
                                                        </Button>
                                                        <Button variant="outline" className="justify-start gap-2 text-red-500 hover:text-red-600" onClick={() => updateJobStatus(job.id, 'Cancelled')}>
                                                            <AlertCircle className="h-4 w-4" /> Cancel Job
                                                        </Button>
                                                        <Button variant="outline" className="justify-start gap-2">
                                                            <User className="h-4 w-4 text-primary" /> Change Staff
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </SheetContent>
                                    </Sheet>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-dashed border-2 bg-muted/20">
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <ClipboardCheck className="h-4 w-4 text-primary" />
                            Job Compliance Checklist
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs space-y-3">
                        <p className="text-muted-foreground italic">"Ensure all inspection photos are uploaded before marking a job as Completed."</p>
                        <div className="flex items-center gap-2 text-emerald-600 font-bold uppercase tracking-tighter">
                            <AlertCircle className="h-3 w-3" /> QA Standards Applied
                        </div>
                    </CardContent>
                </Card>
                <Card className="flex items-center justify-center p-6 text-center">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <h3 className="font-headline text-xl font-bold">Industry Intelligence</h3>
                            <p className="text-sm text-muted-foreground">Automate your service consumption. Link inventory items to specific job types for automatic stock deduction.</p>
                        </div>
                        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => toast({ title: "Module Configuration", description: "BOM management is a premium feature. Contact support to enable." })}>
                            Configure Service BOM
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}
