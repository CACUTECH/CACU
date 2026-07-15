
"use client";

import * as React from "react";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle, 
    CardFooter 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { 
    UserX, 
    FileText, 
    Printer, 
    Download, 
    Send, 
    ArrowLeft, 
    AlertCircle, 
    CheckCircle2, 
    Loader2,
    Eye,
    Edit2,
    Save,
    LayoutDashboard,
    ClipboardCheck,
    Coins,
    MessageSquare,
    BarChart3,
    PlusCircle,
    MoreHorizontal,
    Search,
    History,
    FileSearch,
    Trash2,
    Clock,
    Package,
    Lock,
    Sparkles
} from "lucide-react";
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogFooter, 
    DialogHeader, 
    DialogTitle, 
    DialogTrigger,
    DialogClose 
} from "@/components/ui/dialog";
import { 
    DropdownMenu, 
    DropdownMenuContent, 
    DropdownMenuItem, 
    DropdownMenuLabel, 
    DropdownMenuTrigger, 
    DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { 
    Table, 
    TableBody, 
    TableCell, 
    TableHead, 
    TableHeader, 
    TableRow 
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { employees, initialExits, initialExitQueries } from "@/lib/data";
import type { ExitRequest, ExitQuery, ExitType, ExitStatus } from "@/lib/data";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { generateHRLetter } from "@/ai/flows/termination-letter-flow";
import * as XLSX from 'xlsx';

export default function TerminationPage() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = React.useState("dashboard");
    const [exits, setExits] = React.useState<ExitRequest[]>(initialExits);
    const [queries, setQueries] = React.useState<ExitQuery[]>(initialExitQueries);
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [aiLetter, setAiLetter] = React.useState<{ subject: string, content: string } | null>(null);
    const [isEditingLetter, setIsEditingLetter] = React.useState(false);
    
    // New Exit Form State
    const [newExit, setNewExit] = React.useState<Partial<ExitRequest>>({
        employeeId: "",
        exitType: "Resignation",
        reason: "",
        lastWorkingDay: format(new Date(), "yyyy-MM-dd"),
    });

    const selectedEmployee = employees.find(e => e.id === newExit.employeeId);

    const handleCreateExit = () => {
        if (!newExit.employeeId || !newExit.reason) {
            toast({ variant: "destructive", title: "Missing Fields", description: "Please select an employee and provide a reason." });
            return;
        }

        const request: ExitRequest = {
            id: `exit-${Date.now()}`,
            employeeId: newExit.employeeId!,
            employeeName: selectedEmployee?.name || "Unknown",
            department: selectedEmployee?.department || "Unassigned",
            jobTitle: selectedEmployee?.role || "Staff",
            exitType: newExit.exitType as ExitType,
            reason: newExit.reason!,
            lastWorkingDay: newExit.lastWorkingDay!,
            status: 'Pending Approval',
            checklist: {
                assetsReturned: false,
                accessRevoked: false,
                handoverDone: false,
                exitInterviewDone: false,
                finalSettlementDone: false,
            },
            finalSettlement: {
                salaryDue: selectedEmployee?.baseSalary || 0,
                leaveEncashment: 0,
                gratuity: 0,
                deductions: 0,
                netPay: selectedEmployee?.baseSalary || 0,
            }
        };

        setExits([request, ...exits]);
        setActiveTab("active");
        setNewExit({ employeeId: "", exitType: "Resignation", reason: "", lastWorkingDay: format(new Date(), "yyyy-MM-dd") });
        toast({ title: "Exit Initialized", description: "Offboarding workflow has been triggered." });
    };

    const handleAIGenerate = async (exit: ExitRequest) => {
        setIsGenerating(true);
        try {
            const result = await generateHRLetter({
                employeeName: exit.employeeName,
                jobTitle: exit.jobTitle,
                exitType: exit.exitType,
                lastWorkingDay: exit.lastWorkingDay,
                reason: exit.reason,
            });
            setAiLetter(result);
            toast({ title: "AI Letter Drafted", description: `Professional ${exit.exitType} document ready for review.` });
        } catch (error) {
            toast({ variant: "destructive", title: "AI Error", description: "Could not generate letter at this time." });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExport = () => {
        const worksheet = XLSX.utils.json_to_sheet(exits.map(e => ({
            ID: e.id,
            Employee: e.employeeName,
            Department: e.department,
            Type: e.exitType,
            Status: e.status,
            'Last Working Day': e.lastWorkingDay,
            'Net Settlement': e.finalSettlement.netPay
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Exits");
        XLSX.writeFile(workbook, `Exit_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    const updateChecklist = (exitId: string, item: keyof ExitRequest['checklist']) => {
        setExits(prev => prev.map(e => {
            if (e.id === exitId) {
                return { ...e, checklist: { ...e.checklist, [item]: !e.checklist[item] } };
            }
            return e;
        }));
    };

    // Stats
    const onNoticeCount = exits.filter(e => e.status === 'On Notice').length;
    const pendingClearance = exits.filter(e => e.status === 'Pending Clearance').length;
    const resolvedQueries = queries.filter(q => q.status === 'Resolved').length;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Offboarding Command Center</h1>
                    <p className="text-muted-foreground mt-1">Manage employee exits, clearances, and AI documentation.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport}>
                        <Download className="mr-2 h-4 w-4" /> Export Report
                    </Button>
                    <Button size="sm" onClick={() => setActiveTab("new")} className="rounded-xl shadow-lg shadow-primary/20">
                        <PlusCircle className="mr-2 h-4 w-4" /> Initiate Exit
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-primary/5 border border-primary/10 shadow-xl shadow-primary/5 rounded-xl mb-8">
                    <TabsTrigger value="dashboard" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                        <LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="active" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                        <FileSearch className="w-4 h-4 mr-2" /> Active Exits
                    </TabsTrigger>
                    <TabsTrigger value="support" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                        <MessageSquare className="w-4 h-4 mr-2" /> Support & Queries
                    </TabsTrigger>
                    <TabsTrigger value="new" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                        <UserX className="w-4 h-4 mr-2" /> New Request
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard title="On Notice" value={onNoticeCount.toString()} subtext="Active handovers" icon={Clock} />
                        <SummaryCard title="Pending Clearance" value={pendingClearance.toString()} subtext="Asset/Finance review" icon={ClipboardCheck} />
                        <SummaryCard title="Open Queries" value={(queries.length - resolvedQueries).toString()} subtext="Awaiting response" icon={MessageSquare} />
                        <SummaryCard title="Final Settlements" value="₦2.4M" subtext="MTD Projected" icon={Coins} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-lg">Recent Offboarding Activity</CardTitle>
                                <CardDescription>Tracking live status of current employee departures.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="pl-6">Employee</TableHead>
                                            <TableHead>Exit Type</TableHead>
                                            <TableHead>Progress</TableHead>
                                            <TableHead className="text-right pr-6">Last Day</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {exits.slice(0, 5).map(e => {
                                            const completedSteps = Object.values(e.checklist).filter(v => v).length;
                                            const progress = (completedSteps / 5) * 100;
                                            return (
                                                <TableRow key={e.id} className="hover:bg-muted/10 cursor-pointer" onClick={() => setActiveTab("active")}>
                                                    <TableCell className="pl-6 py-4">
                                                        <p className="font-bold text-sm">{e.employeeName}</p>
                                                        <p className="text-xs text-muted-foreground">{e.department}</p>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary" className="text-[10px] uppercase">{e.exitType}</Badge>
                                                    </TableCell>
                                                    <TableCell className="w-[150px]">
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between text-[10px] font-bold">
                                                                <span>{completedSteps}/5</span>
                                                                <span>{Math.round(progress)}%</span>
                                                            </div>
                                                            <Progress value={progress} className="h-1" />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6 text-sm font-medium">
                                                        {e.lastWorkingDay}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        <div className="space-y-6">
                            <Card className="bg-primary/5 border-primary/10">
                                <CardHeader>
                                    <CardTitle className="text-sm">HR Policy Alert</CardTitle>
                                </CardHeader>
                                <CardContent className="text-xs space-y-3">
                                    <div className="flex gap-2">
                                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                                        <p>Standard notice period for <strong>Senior Roles</strong> is 1 month as per CACU Handbook.</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                        <p>Final settlement should be disbursed within 48 hours of clearance.</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm">System Integration</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
                                        <span>Payroll Link</span>
                                        <span className="text-emerald-600">Active</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
                                        <span>IT Access API</span>
                                        <span className="text-emerald-600">Syncing</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="active" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Active Offboarding Directory</CardTitle>
                                <div className="flex items-center gap-2">
                                    <Search className="h-4 w-4 text-muted-foreground" />
                                    <Input placeholder="Filter exits..." className="w-64 h-8" />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="pl-6">Employee</TableHead>
                                        <TableHead>Type & Status</TableHead>
                                        <TableHead>Clearance Checklist</TableHead>
                                        <TableHead className="text-right">Settlement (₦)</TableHead>
                                        <TableHead className="text-right pr-6">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {exits.map(e => (
                                        <TableRow key={e.id}>
                                            <TableCell className="pl-6 py-4">
                                                <p className="font-bold text-sm">{e.employeeName}</p>
                                                <p className="text-xs text-muted-foreground">{e.jobTitle}</p>
                                            </TableCell>
                                            <TableCell>
                                                <div className="space-y-1">
                                                    <Badge variant="outline" className="text-[10px] uppercase">{e.exitType}</Badge>
                                                    <p className="text-[10px] font-bold text-primary uppercase">{e.status}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="grid grid-cols-5 gap-1">
                                                    <CheckItem icon={Package} active={e.checklist.assetsReturned} onClick={() => updateChecklist(e.id, 'assetsReturned')} label="Assets" />
                                                    <CheckItem icon={Lock} active={e.checklist.accessRevoked} onClick={() => updateChecklist(e.id, 'accessRevoked')} label="Access" />
                                                    <CheckItem icon={ArrowLeft} active={e.checklist.handoverDone} onClick={() => updateChecklist(e.id, 'handoverDone')} label="Handover" />
                                                    <CheckItem icon={Users} active={e.checklist.exitInterviewDone} onClick={() => updateChecklist(e.id, 'exitInterviewDone')} label="Interview" />
                                                    <CheckItem icon={Coins} active={e.checklist.finalSettlementDone} onClick={() => updateChecklist(e.id, 'finalSettlementDone')} label="Pay" />
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold">
                                                ₦{e.finalSettlement.netPay.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-56">
                                                        <DropdownMenuLabel>Offboarding Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => handleAIGenerate(e)}>
                                                            <Sparkles className="h-4 w-4 mr-2 text-primary" /> Generate Letter
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem>
                                                            <History className="h-4 w-4 mr-2" /> View Audit Trail
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="text-emerald-600">
                                                            <CheckCircle2 className="h-4 w-4 mr-2" /> Finalize Exit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive">
                                                            <Trash2 className="h-4 w-4 mr-2" /> Cancel Process
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {aiLetter && (
                        <Card className="border-primary bg-primary/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="font-headline flex items-center gap-2">
                                        <Sparkles className="h-5 w-5 text-primary" />
                                        AI Drafted HR Document
                                    </CardTitle>
                                    <CardDescription>Professional draft generated based on exit context.</CardDescription>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setIsEditingLetter(!isEditingLetter)}>
                                        {isEditingLetter ? "Finish Editing" : "Refine Text"}
                                    </Button>
                                    <Button size="sm" onClick={() => setAiLetter(null)} variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl border bg-background font-mono text-sm shadow-inner">
                                        <p className="font-bold border-b pb-2 mb-4">Subject: {aiLetter.subject}</p>
                                        {isEditingLetter ? (
                                            <Textarea 
                                                value={aiLetter.content} 
                                                onChange={(e) => setAiLetter({ ...aiLetter, content: e.target.value })}
                                                className="min-h-[300px] border-none shadow-none focus-visible:ring-0 p-0 text-xs leading-relaxed"
                                            />
                                        ) : (
                                            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{aiLetter.content}</pre>
                                        )}
                                    </div>
                                    <div className="flex justify-end gap-3">
                                        <Button variant="outline" size="sm"><Printer className="h-4 w-4 mr-2" /> Print</Button>
                                        <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" /> PDF</Button>
                                        <Button size="sm"><Send className="h-4 w-4 mr-2" /> Send to Employee</Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="support" className="space-y-6">
                    <div className="grid lg:grid-cols-12 gap-8">
                        <div className="lg:col-span-4 space-y-4">
                            <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Active Queries</h3>
                            {queries.map(q => (
                                <Card key={q.id} className={cn(
                                    "cursor-pointer hover:border-primary transition-all",
                                    q.status === 'Open' ? "border-l-4 border-l-amber-500" : "opacity-70"
                                )}>
                                    <CardHeader className="p-4">
                                        <div className="flex justify-between items-start">
                                            <Badge variant={q.status === 'Open' ? 'default' : 'secondary'}>{q.status}</Badge>
                                            <span className="text-[10px] text-muted-foreground font-mono">#{q.id}</span>
                                        </div>
                                        <CardTitle className="text-sm mt-2">{q.subject}</CardTitle>
                                        <CardDescription className="text-xs truncate">{q.message}</CardDescription>
                                    </CardHeader>
                                    <CardFooter className="p-4 pt-0 text-[10px] font-bold text-muted-foreground uppercase">
                                        From: {q.employeeName}
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                        <div className="lg:col-span-8">
                            {queries.length > 0 ? (
                                <Card className="h-full flex flex-col shadow-xl border-primary/10">
                                    <CardHeader className="border-b bg-muted/20">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <CardTitle className="text-lg">{queries[0].subject}</CardTitle>
                                                <CardDescription>Discussion with {queries[0].employeeName}</CardDescription>
                                            </div>
                                            <Button variant="outline" size="sm">Mark as Resolved</Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex-1 p-0 overflow-hidden">
                                        <ScrollArea className="h-[400px] p-6">
                                            <div className="space-y-6">
                                                <div className="flex flex-col gap-2 max-w-[80%]">
                                                    <div className="bg-muted p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed">
                                                        {queries[0].message}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground font-bold">{queries[0].employeeName} • 2:30 PM</span>
                                                </div>
                                                {queries[0].replies.map((r, i) => (
                                                    <div key={i} className={cn("flex flex-col gap-2 max-w-[80%]", r.role === 'HR' ? "ml-auto items-end" : "items-start")}>
                                                        <div className={cn(
                                                            "p-4 rounded-2xl text-sm leading-relaxed",
                                                            r.role === 'HR' ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted rounded-tl-none"
                                                        )}>
                                                            {r.text}
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground font-bold">{r.role} • {r.date}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </CardContent>
                                    <CardFooter className="p-6 border-t bg-muted/10 space-y-4">
                                        <div className="w-full space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Sparkles className="h-3 w-3 text-primary" />
                                                <span className="text-[10px] uppercase font-bold text-primary">AI Suggestion:</span>
                                                <p className="text-[10px] text-muted-foreground italic flex-1 truncate">
                                                    Explain that gratuity is calculated at 2 weeks per year of service as per handbook...
                                                </p>
                                                <Button variant="ghost" size="sm" className="h-6 text-[10px] font-bold">Apply Draft</Button>
                                            </div>
                                            <div className="flex gap-2">
                                                <Input placeholder="Type your response..." className="bg-background rounded-xl" />
                                                <Button size="icon" className="rounded-xl"><Send className="h-4 w-4" /></Button>
                                            </div>
                                        </div>
                                    </CardFooter>
                                </Card>
                            ) : (
                                <div className="h-full flex items-center justify-center border-2 border-dashed rounded-xl bg-muted/20 opacity-40">
                                    <p className="font-bold text-muted-foreground">Select a query to view discussion</p>
                                </div>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="new" className="space-y-6">
                    <div className="max-w-3xl mx-auto">
                        <Card className="shadow-2xl border-primary/10">
                            <CardHeader className="text-center bg-primary/5 border-b py-8">
                                <div className="bg-primary/10 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4">
                                    <UserX className="h-8 w-8 text-primary" />
                                </div>
                                <CardTitle className="font-headline text-2xl">Initiate Employee Offboarding</CardTitle>
                                <CardDescription>Capture essential exit details to trigger the workflow.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-8 py-8 px-8">
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Target Employee</Label>
                                        <Select value={newExit.employeeId} onValueChange={(val) => setNewExit({...newExit, employeeId: val})}>
                                            <SelectTrigger className="h-12 rounded-xl">
                                                <SelectValue placeholder="Search member..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {employees.filter(e => e.status !== 'Terminated').map(e => (
                                                    <SelectItem key={e.id} value={e.id}>{e.name} ({e.role})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Exit Type</Label>
                                        <Select value={newExit.exitType} onValueChange={(val: ExitType) => setNewExit({...newExit, exitType: val})}>
                                            <SelectTrigger className="h-12 rounded-xl">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Resignation">Resignation</SelectItem>
                                                <SelectItem value="Termination">Termination</SelectItem>
                                                <SelectItem value="Retirement">Retirement</SelectItem>
                                                <SelectItem value="Contract Expiry">Contract Expiry</SelectItem>
                                                <SelectItem value="Other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Last Working Day</Label>
                                        <Input 
                                            type="date" 
                                            value={newExit.lastWorkingDay} 
                                            onChange={(e) => setNewExit({...newExit, lastWorkingDay: e.target.value})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Notice Period (Days)</Label>
                                        <Input type="number" placeholder="e.g. 30" className="h-12 rounded-xl" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Primary Reason for Exit</Label>
                                    <Textarea 
                                        placeholder="Detailed explanation for internal records..." 
                                        className="min-h-[120px] rounded-xl"
                                        value={newExit.reason}
                                        onChange={(e) => setNewExit({...newExit, reason: e.target.value})}
                                    />
                                </div>

                                <Separator />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-bold text-sm">Automated Settlement Projection</h4>
                                            <p className="text-xs text-muted-foreground">Estimate based on current base pay and outstanding items.</p>
                                        </div>
                                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">Projected</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 border">
                                        <div className="space-y-1">
                                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Salary Due</p>
                                            <p className="text-lg font-bold">₦{(selectedEmployee?.baseSalary || 0).toLocaleString()}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Deductions (Est.)</p>
                                            <p className="text-lg font-bold text-red-600">₦0</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="p-8 border-t flex flex-col gap-3">
                                <Button className="w-full h-14 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20" onClick={handleCreateExit}>
                                    Initialize Offboarding
                                </Button>
                                <p className="text-[10px] text-center text-muted-foreground">
                                    By clicking initialize, the system will notify IT for access revocation and create a draft final settlement.
                                </p>
                            </CardFooter>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function SummaryCard({ title, value, subtext, icon: Icon }: { title: string, value: string, subtext: string, icon: any }) {
    return (
        <Card className="hover:shadow-md transition-shadow border-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-[10px] text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    );
}

function CheckItem({ icon: Icon, active, onClick, label }: { icon: any, active: boolean, onClick: () => void, label: string }) {
    return (
        <button 
            onClick={onClick}
            className={cn(
                "flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all gap-1 group",
                active ? "bg-emerald-500 border-emerald-500 text-white" : "bg-muted/50 border-muted hover:border-primary/50"
            )}
            title={label}
        >
            <Icon className="h-3 w-3" />
            <span className="text-[8px] font-bold uppercase tracking-tighter">{label}</span>
        </button>
    );
}
