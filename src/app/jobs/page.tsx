
"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlusCircle, Search, Filter, Wrench, Clock, User, ArrowRight, ClipboardCheck, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { jobs as initialJobs, employees } from "@/lib/data"
import type { Job } from "@/lib/data"

export default function JobsPage() {
    const [searchTerm, setSearchTerm] = React.useState("")
    const [jobsList] = React.useState<Job[]>(initialJobs)

    const getStatusStyles = (status: Job['status']) => {
        switch(status) {
            case 'Completed': return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
            case 'In Progress': return "bg-blue-500/10 text-blue-700 border-blue-500/20";
            case 'Assigned': return "bg-indigo-500/10 text-indigo-700 border-indigo-500/20";
            case 'Pending': return "bg-amber-500/10 text-amber-700 border-amber-500/20";
            case 'Cancelled': return "bg-red-500/10 text-red-700 border-red-500/20";
            default: return "";
        }
    }

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Work Orders & Jobs</h1>
                    <p className="text-muted-foreground mt-1">Track service delivery from assignment to completion.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Filter className="mr-2 h-4 w-4" />
                        Filter
                    </Button>
                    <Button size="sm" className="rounded-xl shadow-lg shadow-primary/20">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Create Work Order
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-primary/5 border-primary/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Active Jobs</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">12</div>
                        <p className="text-[10px] text-muted-foreground mt-1">Across 4 team members</p>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/5 border-amber-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Awaiting Parts</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">3</div>
                        <p className="text-[10px] text-muted-foreground mt-1">Check inventory status</p>
                    </CardContent>
                </Card>
                <Card className="bg-emerald-500/5 border-emerald-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Ready for Invoice</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">8</div>
                        <p className="text-[10px] text-muted-foreground mt-1">₦425,000 potential revenue</p>
                    </CardContent>
                </Card>
                <Card className="bg-red-500/5 border-red-500/10">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Overdue</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-3xl font-bold font-headline">2</div>
                        <p className="text-[10px] text-red-500 font-bold mt-1">Requires urgent attention</p>
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
                            {jobsList.map((job) => {
                                const staff = employees.find(e => e.id === job.assignedStaffId);
                                return (
                                    <TableRow key={job.id} className="hover:bg-primary/5 transition-colors cursor-pointer group">
                                        <TableCell className="pl-6">
                                            <div className="space-y-1">
                                                <div className="font-bold text-sm group-hover:text-primary transition-colors">{job.title}</div>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <User className="h-3 w-3" /> {job.customerName}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase font-bold tracking-tighter mt-1">
                                                    <Clock className="h-3 w-3" /> Due {job.dueDate}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                                                    {staff?.name.charAt(0)}
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
                                            <Button variant="ghost" size="icon" className="rounded-full">
                                                <ArrowRight className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
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
                        <Button variant="outline" size="sm" className="rounded-xl">Configure Service BOM</Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}
