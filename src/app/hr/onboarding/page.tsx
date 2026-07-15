
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
    UserPlus, 
    Sparkles, 
    LayoutDashboard, 
    FileSearch, 
    MessageSquare, 
    CheckCircle2, 
    Clock, 
    Loader2, 
    MoreHorizontal, 
    Download, 
    Printer, 
    Send, 
    PlusCircle,
    ArrowRight,
    Users,
    ClipboardCheck,
    Briefcase,
    Building2,
    CalendarDays,
    Trash2,
    Monitor
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
import { initialOnboarding, initialOnboardingQueries, employees } from "@/lib/data";
import type { OnboardingRequest, OnboardingQuery, OnboardingStatus, EmploymentType } from "@/lib/data";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { generateOnboardingDocument } from "@/ai/flows/onboarding-document-flow";
import * as XLSX from 'xlsx';

export default function OnboardingPage() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = React.useState("dashboard");
    const [onboardings, setOnboardings] = React.useState<OnboardingRequest[]>(initialOnboarding);
    const [queries, setQueries] = React.useState<OnboardingQuery[]>(initialOnboardingQueries);
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [aiDoc, setAiDoc] = React.useState<{ subject: string, content: string } | null>(null);

    // New Onboarding Form State
    const [newOnb, setNewOnb] = React.useState<Partial<OnboardingRequest>>({
        employeeName: "",
        email: "",
        jobTitle: "",
        department: "Operations",
        employmentType: "Full-time",
        startDate: format(new Date(), "yyyy-MM-dd"),
        salary: 0,
        managerName: "Jane Doe",
    });

    const handleCreateOnboarding = () => {
        if (!newOnb.employeeName || !newOnb.email) {
            toast({ variant: "destructive", title: "Missing Fields", description: "Name and Email are required." });
            return;
        }

        const request: OnboardingRequest = {
            id: `onb-${Date.now()}`,
            employeeName: newOnb.employeeName!,
            email: newOnb.email!,
            jobTitle: newOnb.jobTitle || "Staff",
            department: newOnb.department || "Operations",
            employmentType: newOnb.employmentType as EmploymentType,
            startDate: newOnb.startDate!,
            salary: newOnb.salary || 0,
            managerName: newOnb.managerName!,
            status: 'Draft',
            checklist: [
                { id: 't1', task: 'Offer Accepted', completed: false, category: 'Legal' },
                { id: 't2', task: 'Contract Signed', completed: false, category: 'Legal' },
                { id: 't3', task: 'Bank Details Provided', completed: false, category: 'Admin' },
                { id: 't4', task: 'Email Account Setup', completed: false, category: 'IT' },
            ]
        };

        setOnboardings([request, ...onboardings]);
        setActiveTab("active");
        setNewOnb({ employeeName: "", email: "", jobTitle: "", department: "Operations", employmentType: "Full-time", startDate: format(new Date(), "yyyy-MM-dd"), salary: 0, managerName: "Jane Doe" });
        toast({ title: "Onboarding Initialized", description: "New hire profile created." });
    };

    const handleAIGenerate = async (onb: OnboardingRequest, docType: string) => {
        setIsGenerating(true);
        try {
            const result = await generateOnboardingDocument({
                employeeName: onb.employeeName,
                jobTitle: onb.jobTitle,
                department: onb.department,
                salary: onb.salary,
                startDate: onb.startDate,
                docType: docType as any,
            });
            setAiDoc(result);
            toast({ title: "AI Document Drafted", description: `${docType} ready for review.` });
        } catch (error) {
            toast({ variant: "destructive", title: "AI Error", description: "Could not generate document." });
        } finally {
            setIsGenerating(false);
        }
    };

    const updateChecklist = (onbId: string, taskId: string) => {
        setOnboardings(prev => prev.map(o => {
            if (o.id === onbId) {
                return {
                    ...o,
                    checklist: o.checklist.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t)
                };
            }
            return o;
        }));
    };

    const handleExport = () => {
        const worksheet = XLSX.utils.json_to_sheet(onboardings.map(o => ({
            ID: o.id,
            Name: o.employeeName,
            Role: o.jobTitle,
            Dept: o.department,
            Status: o.status,
            'Start Date': o.startDate
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Onboarding");
        XLSX.writeFile(workbook, `Onboarding_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    // Stats
    const startingThisWeek = onboardings.filter(o => {
        const start = new Date(o.startDate);
        const diff = (start.getTime() - new Date().getTime()) / (1000 * 3600 * 24);
        return diff >= 0 && diff <= 7;
    }).length;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">Employee Onboarding</h1>
                    <p className="text-muted-foreground mt-1">Automate new hire integration and documentation with AI.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport}>
                        <Download className="mr-2 h-4 w-4" /> Export
                    </Button>
                    <Button size="sm" onClick={() => setActiveTab("new")} className="rounded-xl shadow-lg shadow-primary/20">
                        <PlusCircle className="mr-2 h-4 w-4" /> Add New Hire
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto p-1 bg-primary/5 border border-primary/10 shadow-xl shadow-primary/5 rounded-xl mb-8">
                    <TabsTrigger value="dashboard" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="active" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <Users className="w-4 h-4 mr-2" /> New Hires
                    </TabsTrigger>
                    <TabsTrigger value="support" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <MessageSquare className="w-4 h-4 mr-2" /> Support
                    </TabsTrigger>
                    <TabsTrigger value="new" className="py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white transition-all shadow-sm">
                        <UserPlus className="w-4 h-4 mr-2" /> Initiate Onb.
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        <SummaryCard title="Starts This Week" value={startingThisWeek.toString()} subtext="Ready for welcome" icon={CalendarDays} />
                        <SummaryCard title="Pending Docs" value={onboardings.filter(o => o.checklist.some(t => t.category === 'Legal' && !t.completed)).length.toString()} subtext="Awaiting signature" icon={Briefcase} />
                        <SummaryCard title="Awaiting IT" value={onboardings.filter(o => o.checklist.some(t => t.category === 'IT' && !t.completed)).length.toString()} subtext="Equipment/Access" icon={Monitor} />
                        <SummaryCard title="Completion Rate" value="84%" subtext="MTD Average" icon={CheckCircle2} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-lg">Recent Hiring Pipeline</CardTitle>
                                <CardDescription>Tracking the status of upcoming team members.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="pl-6">New Hire</TableHead>
                                            <TableHead>Role</TableHead>
                                            <TableHead>Onboarding Status</TableHead>
                                            <TableHead className="text-right pr-6">Start Date</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {onboardings.map(o => {
                                            const completed = o.checklist.filter(t => t.completed).length;
                                            const progress = (completed / o.checklist.length) * 100;
                                            return (
                                                <TableRow key={o.id} className="hover:bg-muted/10 cursor-pointer" onClick={() => setActiveTab("active")}>
                                                    <TableCell className="pl-6 py-4">
                                                        <p className="font-bold text-sm">{o.employeeName}</p>
                                                        <p className="text-xs text-muted-foreground">{o.email}</p>
                                                    </TableCell>
                                                    <TableCell className="text-sm font-medium">{o.jobTitle}</TableCell>
                                                    <TableCell className="w-[150px]">
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between text-[10px] font-bold">
                                                                <span>{o.status}</span>
                                                                <span>{Math.round(progress)}%</span>
                                                            </div>
                                                            <Progress value={progress} className="h-1" />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6 text-sm font-bold text-primary">
                                                        {o.startDate}
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
                                    <CardTitle className="text-sm">AI Welcome Tip</CardTitle>
                                </CardHeader>
                                <CardContent className="text-xs space-y-3">
                                    <div className="flex gap-2">
                                        <Sparkles className="h-4 w-4 text-primary shrink-0" />
                                        <p>Personalize the welcome email for <strong>Amara Kalu</strong> by mentioning the recent Project Alpha launch.</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                                        <p>3 employees have start dates within 48 hours but haven't completed IT access forms.</p>
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button size="sm" variant="outline" className="w-full text-xs">Generate Reminders</Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="active" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Hiring Pipeline Detail</CardTitle>
                            <CardDescription>Manage documentation and task checklists for each new hire.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="pl-6">New Hire</TableHead>
                                        <TableHead>Tasks Remaining</TableHead>
                                        <TableHead>Start Date</TableHead>
                                        <TableHead className="text-right pr-6">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {onboardings.map(o => {
                                        const pending = o.checklist.filter(t => !t.completed).length;
                                        return (
                                            <TableRow key={o.id}>
                                                <TableCell className="pl-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase">
                                                            {o.employeeName.split(' ').map(n => n[0]).join('')}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-sm">{o.employeeName}</p>
                                                            <p className="text-xs text-muted-foreground">{o.jobTitle} • {o.department}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {o.checklist.filter(t => !t.completed).slice(0, 2).map(t => (
                                                            <Badge key={t.id} variant="outline" className="text-[9px] uppercase">{t.task}</Badge>
                                                        ))}
                                                        {pending > 2 && <span className="text-[10px] text-muted-foreground font-bold">+{pending - 2} more</span>}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">{o.startDate}</TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-56">
                                                            <DropdownMenuLabel>Onboarding Actions</DropdownMenuLabel>
                                                            <DropdownMenuItem onClick={() => handleAIGenerate(o, 'Offer Letter')}>
                                                                <Sparkles className="h-4 w-4 mr-2 text-primary" /> Generate Offer
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleAIGenerate(o, 'Employment Contract')}>
                                                                <Briefcase className="h-4 w-4 mr-2 text-primary" /> Generate Contract
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem>
                                                                <CheckCircle2 className="h-4 w-4 mr-2" /> Mark Completed
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem className="text-destructive">
                                                                <Trash2 className="h-4 w-4 mr-2" /> Cancel Hire
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {aiDoc && (
                        <Card className="border-primary bg-primary/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="font-headline flex items-center gap-2">
                                        <Sparkles className="h-5 w-5 text-primary" />
                                        AI Onboarding Assistant
                                    </CardTitle>
                                    <CardDescription>Drafted document ready for review and transmission.</CardDescription>
                                </div>
                                <Button size="sm" onClick={() => setAiDoc(null)} variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl border bg-background font-mono text-sm shadow-inner">
                                        <p className="font-bold border-b pb-2 mb-4">Subject: {aiDoc.subject}</p>
                                        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{aiDoc.content}</pre>
                                    </div>
                                    <div className="flex justify-end gap-3">
                                        <Button variant="outline" size="sm"><Printer className="h-4 w-4 mr-2" /> Print</Button>
                                        <Button size="sm"><Send className="h-4 w-4 mr-2" /> Email to Hire</Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="support" className="space-y-6">
                    <div className="grid lg:grid-cols-12 gap-8">
                        <div className="lg:col-span-4 space-y-4">
                            <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">New Hire Queries</h3>
                            {queries.map(q => (
                                <Card key={q.id} className={cn(
                                    "cursor-pointer hover:border-primary transition-all",
                                    q.status === 'Open' ? "border-l-4 border-l-primary" : "opacity-70"
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
                                                <CardDescription>Support thread with {queries[0].employeeName}</CardDescription>
                                            </div>
                                            <Button variant="outline" size="sm">Resolve Thread</Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex-1 p-0 overflow-hidden">
                                        <ScrollArea className="h-[400px] p-6">
                                            <div className="space-y-6">
                                                <div className="flex flex-col gap-2 max-w-[80%]">
                                                    <div className="bg-muted p-4 rounded-2xl rounded-tl-none text-sm leading-relaxed">
                                                        {queries[0].message}
                                                    </div>
                                                    <span className="text-[10px] text-muted-foreground font-bold">{queries[0].employeeName} • 10:45 AM</span>
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
                                                <span className="text-[10px] uppercase font-bold text-primary">AI Suggested Reply:</span>
                                                <p className="text-[10px] text-muted-foreground italic flex-1 truncate">
                                                    We offer a choice between a 14" MacBook Pro or a high-spec Dell Latitude.
                                                </p>
                                                <Button variant="ghost" size="sm" className="h-6 text-[10px] font-bold">Apply</Button>
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
                                    <p className="font-bold text-muted-foreground">Select a support ticket to view</p>
                                </div>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="new" className="space-y-6">
                    <div className="max-w-4xl mx-auto">
                        <Card className="shadow-2xl border-primary/10">
                            <CardHeader className="text-center bg-primary/5 border-b py-8">
                                <div className="bg-primary/10 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4">
                                    <UserPlus className="h-8 w-8 text-primary" />
                                </div>
                                <CardTitle className="font-headline text-2xl">Initialize New Hire Onboarding</CardTitle>
                                <CardDescription>Start the professional integration process for a new team member.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-8 py-8 px-8">
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Full Name</Label>
                                        <Input 
                                            placeholder="Enter name..." 
                                            value={newOnb.employeeName} 
                                            onChange={(e) => setNewOnb({...newOnb, employeeName: e.target.value})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Work Email</Label>
                                        <Input 
                                            type="email" 
                                            placeholder="name@company.com" 
                                            value={newOnb.email} 
                                            onChange={(e) => setNewOnb({...newOnb, email: e.target.value})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Job Title</Label>
                                        <Input 
                                            placeholder="e.g. Sales Director" 
                                            value={newOnb.jobTitle} 
                                            onChange={(e) => setNewOnb({...newOnb, jobTitle: e.target.value})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Department</Label>
                                        <Select value={newOnb.department} onValueChange={(val) => setNewOnb({...newOnb, department: val})}>
                                            <SelectTrigger className="h-12 rounded-xl">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Operations">Operations</SelectItem>
                                                <SelectItem value="Engineering">Engineering</SelectItem>
                                                <SelectItem value="Sales">Sales</SelectItem>
                                                <SelectItem value="Product">Product</SelectItem>
                                                <SelectItem value="HR">Human Resources</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Employment Type</Label>
                                        <Select value={newOnb.employmentType} onValueChange={(val: EmploymentType) => setNewOnb({...newOnb, employmentType: val})}>
                                            <SelectTrigger className="h-12 rounded-xl">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Full-time">Full-time</SelectItem>
                                                <SelectItem value="Contract">Contract</SelectItem>
                                                <SelectItem value="Part-time">Part-time</SelectItem>
                                                <SelectItem value="Internship">Internship</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Start Date</Label>
                                        <Input 
                                            type="date" 
                                            value={newOnb.startDate} 
                                            onChange={(e) => setNewOnb({...newOnb, startDate: e.target.value})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Monthly Salary (₦)</Label>
                                        <Input 
                                            type="number" 
                                            placeholder="0" 
                                            value={newOnb.salary || ""} 
                                            onChange={(e) => setNewOnb({...newOnb, salary: parseFloat(e.target.value) || 0})}
                                            className="h-12 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Reporting Manager</Label>
                                        <Select value={newOnb.managerName} onValueChange={(val) => setNewOnb({...newOnb, managerName: val})}>
                                            <SelectTrigger className="h-12 rounded-xl">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {employees.map(e => (
                                                    <SelectItem key={e.id} value={e.name}>{e.name} ({e.role})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="p-8 border-t flex flex-col gap-3">
                                <Button className="w-full h-14 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20" onClick={handleCreateOnboarding}>
                                    Launch Onboarding Workflow
                                </Button>
                                <p className="text-xs text-center text-muted-foreground">
                                    This will trigger IT access creation, notify the manager, and prepare the digital welcome pack.
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
