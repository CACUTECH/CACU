
"use client";

import * as React from "react";
import { 
    Card, 
    CardHeader, 
    CardTitle, 
    CardContent, 
    CardDescription,
    CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
    FileDown, 
    Loader2, 
    Eye, 
    Calculator, 
    Users, 
    TrendingUp, 
    Wallet, 
    Edit3, 
    Save, 
    CheckCircle2,
    Briefcase,
    Clock,
    PlusCircle,
    ShieldCheck,
    Lock,
    Settings,
    FileText,
    History,
    FileSpreadsheet,
    ArrowRight,
    AlertCircle,
    BadgeAlert,
    BarChart3,
    ArrowUpRight,
    ArrowDownRight,
    RefreshCw
} from "lucide-react";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogFooter, 
    DialogDescription, 
    DialogTrigger, 
    DialogClose 
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { employees, jobs as allJobs, payrollHistory as initialPayrollHistory, initialLoans } from "@/lib/data";
import type { PayrollRun, BusinessType, PayrollRunStatus } from "@/lib/data";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EditableStaffPay {
    employeeId: string;
    name: string;
    basePay: number;
    jobIncentives: number;
    overtime: number;
    loanDeduction: number;
    statutoryDeductions: number; 
    netPay: number;
    grossPay: number;
    issues: string[];
}

export default function PayrollPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(false);
    const [businessType, setBusinessType] = React.useState<BusinessType>('HYBRID');
    const [payrollHistory, setPayrollHistory] = React.useState(initialPayrollHistory);
    const [currentStep, setCurrentStep] = React.useState<'dashboard' | 'prepare' | 'review'>('dashboard');
    const [editablePay, setEditablePay] = React.useState<EditableStaffPay[]>([]);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        const savedType = localStorage.getItem('business-type') as BusinessType;
        if (savedType) setBusinessType(savedType);

        const initialPay = employees.map(emp => {
            const completedJobs = allJobs.filter(j => j.assignedStaffId === emp.id && j.status === 'Completed');
            const incentives = completedJobs.reduce((acc, curr) => acc + (curr.totalAmount * 0.1), 0);
            const loan = initialLoans.find(l => l.employeeId === emp.id && l.status === 'Active');
            const loanDed = loan ? loan.monthlyDeduction : 0;
            const statDed = emp.baseSalary * 0.15;
            
            const grossPay = emp.baseSalary + incentives + 15000;
            const netPay = grossPay - loanDed - statDed;

            const issues: string[] = [];
            if (!emp.bankName) issues.push("Missing Bank Name");
            if (!emp.accountNumber) issues.push("Missing Account Number");
            if (netPay < 0) issues.push("Negative Net Pay Warning");

            return {
                employeeId: emp.id,
                name: emp.name,
                basePay: emp.baseSalary,
                jobIncentives: incentives,
                overtime: 15000, 
                loanDeduction: loanDed,
                statutoryDeductions: statDed,
                grossPay,
                netPay,
                issues
            };
        });
        setEditablePay(initialPay);
    }, []);

    const handlePrepareRun = () => {
        setIsLoading(true);
        setTimeout(() => {
            setCurrentStep('prepare');
            setIsLoading(false);
            toast({ 
                title: "Pre-Payroll Sweep Complete", 
                description: "Validation engine has identified potential issues and calculation anomalies." 
            });
        }, 1200);
    };

    const handleIncentiveChange = (id: string, newVal: string) => {
        const value = parseFloat(newVal) || 0;
        setEditablePay(prev => prev.map(p => {
            if (p.employeeId === id) {
                const newGross = p.basePay + value + p.overtime;
                const newNet = newGross - p.loanDeduction - p.statutoryDeductions;
                return { ...p, jobIncentives: value, grossPay: newGross, netPay: newNet };
            }
            return p;
        }));
    };

    const handleSubmitForReview = () => {
        const criticalIssues = editablePay.flatMap(p => p.issues);
        if (criticalIssues.length > 0) {
            toast({
                variant: "destructive",
                title: "Validation Failed",
                description: "Please resolve missing bank details or negative net pay issues before proceeding.",
            });
            return;
        }
        setCurrentStep('review');
        toast({ 
            title: "Batch Locked for Approval", 
            description: "Calculations frozen. Variance report generated for Auditor review." 
        });
    };

    const handleFinalDisburse = () => {
        setIsLoading(true);
        setTimeout(() => {
            const total = editablePay.reduce((acc, p) => acc + p.netPay, 0);
            const totalGross = editablePay.reduce((acc, p) => acc + p.grossPay, 0);
            const totalDed = totalGross - total;

            const newRun: PayrollRun = {
                id: `run-${Date.now()}`,
                month: 'July 2024',
                totalPaid: total,
                totalGross,
                totalDeductions: totalDed,
                employeesPaid: editablePay.length,
                status: 'Paid',
                preparedBy: 'Jane Doe',
                approvedBy: 'Internal Audit',
                payslips: editablePay.map(p => ({
                    employeeName: p.name,
                    netPay: p.netPay,
                    grossPay: p.grossPay,
                    deductions: p.loanDeduction + p.statutoryDeductions
                }))
            };
            setPayrollHistory(prev => [newRun, ...prev]);
            setIsLoading(false);
            setCurrentStep('dashboard');
            toast({
                title: "Disbursement Triggered",
                description: `₦${total.toLocaleString()} processed via Payment Gateway. GL entries synchronized.`,
            });
        }, 2000);
    };

    // Variance Analytics
    const prevRun = payrollHistory[0];
    const currentTotalNet = editablePay.reduce((acc, p) => acc + p.netPay, 0);
    const variance = prevRun ? ((currentTotalNet - prevRun.totalPaid) / prevRun.totalPaid) * 100 : 0;

    const totalGross = editablePay.reduce((acc, p) => acc + p.grossPay, 0);
    const totalDeductions = editablePay.reduce((acc, p) => acc + p.loanDeduction + p.statutoryDeductions, 0);
    const totalNet = currentTotalNet;

    if (!mounted) return null;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">Staff Payroll Engine</h1>
                    <p className="text-muted-foreground mt-1">Enterprise-grade gross-to-net automation with ecosystem integration.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" asChild size="sm">
                        <Link href="/hr/payroll/config"><Settings className="mr-2 h-4 w-4" /> Policy Config</Link>
                    </Button>
                    {currentStep === 'dashboard' && (
                        <Button onClick={handlePrepareRun} className="rounded-xl shadow-lg shadow-primary/20" disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
                            Run July Batch
                        </Button>
                    )}
                </div>
            </div>

            {currentStep === 'dashboard' && (
                <div className="grid gap-8">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        <Card className="shadow-lg border-primary/5">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Variance Delta</CardTitle>
                                <div className="bg-primary/10 p-2 rounded-lg">
                                    <BarChart3 className="h-4 w-4 text-primary" />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold font-headline">{variance >= 0 ? '+' : ''}{variance.toFixed(1)}%</div>
                                <p className={cn(
                                    "text-[10px] font-medium mt-1 flex items-center gap-1",
                                    variance > 0 ? "text-amber-600" : "text-emerald-600"
                                )}>
                                    {variance > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                    vs. June 2024 Actuals
                                </p>
                            </CardContent>
                        </Card>
                        <PayrollStatCard title="MTD Projected Cost" value={`₦${(totalNet / 1000000).toFixed(2)}M`} subtext="Based on prep data" icon={Wallet} />
                        <PayrollStatCard title="Compliance Health" value="100%" subtext="Remittances synchronized" icon={ShieldCheck} />
                        <PayrollStatCard title="Ecosystem Link" value="ACTIVE" subtext="Time/Job data synced" icon={RefreshCw} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <Card className="lg:col-span-2 shadow-xl shadow-primary/5 border-primary/10">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="font-headline">Batch History & Reconciliation</CardTitle>
                                    <CardDescription>Archive of finalized payroll executions and disbursement logs.</CardDescription>
                                </div>
                                <Button variant="outline" size="sm" className="rounded-xl"><FileDown className="h-4 w-4 mr-2" /> Global Report</Button>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="pl-6">Period</TableHead>
                                            <TableHead className="text-right">Gross (₦)</TableHead>
                                            <TableHead className="text-right">Net (₦)</TableHead>
                                            <TableHead className="text-right pr-6">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payrollHistory.map(run => (
                                            <TableRow key={run.id} className="hover:bg-muted/10 transition-colors group">
                                                <TableCell className="pl-6">
                                                    <p className="font-bold text-sm">{run.month}</p>
                                                    <p className="text-[10px] text-muted-foreground uppercase">{run.employeesPaid} staff paid</p>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-xs">₦{run.totalGross?.toLocaleString() || '--'}</TableCell>
                                                <TableCell className="text-right font-mono font-bold">₦{run.totalPaid.toLocaleString()}</TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">{run.status}</Badge>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100"><Eye className="h-4 w-4" /></Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        <div className="space-y-6">
                            <Card className="bg-primary text-primary-foreground border-none shadow-xl shadow-primary/20 overflow-hidden relative">
                                <div className="absolute top-0 right-0 p-4 opacity-10"><Calculator className="h-24 w-24" /></div>
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        Active Preparation
                                    </CardTitle>
                                    <CardDescription className="text-white/70">July 2024 regular run cycle.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-4xl font-bold font-headline">₦{totalNet.toLocaleString()}</div>
                                    <div className="flex items-center gap-2 mt-4 p-2 bg-white/10 rounded-lg text-[10px] uppercase font-bold tracking-widest">
                                        <AlertCircle className="h-3 w-3" /> 2 Validation Notices
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button variant="secondary" className="w-full bg-white text-primary font-bold shadow-lg" onClick={handlePrepareRun}>Review & Adjust Pay</Button>
                                </CardFooter>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm font-bold">Regulatory Workflows</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Button variant="outline" asChild className="w-full justify-start gap-3 h-12 rounded-xl">
                                        <Link href="/hr/payroll/tax-schedule"><FileSpreadsheet className="h-4 w-4 text-primary" /> Tax Schedule (PAYE)</Link>
                                    </Button>
                                    <Button variant="outline" asChild className="w-full justify-start gap-3 h-12 rounded-xl">
                                        <Link href="/hr/payroll/pension-remittance"><ShieldCheck className="h-4 w-4 text-primary" /> Pension Remittance</Link>
                                    </Button>
                                    <Button variant="outline" asChild className="w-full justify-start gap-3 h-12 rounded-xl">
                                        <Link href="/hr/payroll/loans"><Clock className="h-4 w-4 text-primary" /> Loan Recoup Schedules</Link>
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}

            {(currentStep === 'prepare' || currentStep === 'review') && (
                <div className="space-y-6">
                    {currentStep === 'prepare' && editablePay.some(p => p.issues.length > 0) && (
                        <Alert variant="destructive" className="bg-red-50 border-red-200 text-red-800 shadow-lg">
                            <BadgeAlert className="h-4 w-4" />
                            <AlertTitle className="font-bold">Compliance Warning</AlertTitle>
                            <AlertDescription className="text-xs">
                                The validation engine found issues in {editablePay.filter(p => p.issues.length > 0).length} employee records. Please fix bank details or adjust pay to resolve.
                            </AlertDescription>
                        </Alert>
                    )}

                    <Card className="border-primary/20 shadow-2xl shadow-primary/5 overflow-hidden">
                        <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between py-6">
                            <div>
                                <CardTitle className="font-headline text-2xl">
                                    {currentStep === 'prepare' ? "Pay Preparation & Adjustment" : "Internal Audit Review"}
                                </CardTitle>
                                <CardDescription>Period: July 1, 2024 - July 31, 2024 • Entity: CACU Technologies</CardDescription>
                            </div>
                            <div className="flex gap-4">
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Workflow Stage</p>
                                    <Badge className={cn(
                                        "mt-1 font-bold",
                                        currentStep === 'prepare' ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-blue-100 text-blue-800 border-blue-200"
                                    )}>
                                        {currentStep === 'prepare' ? "MAKER (HR PREP)" : "CHECKER (AUDIT)"}
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="max-h-[500px]">
                                <Table>
                                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                        <TableRow>
                                            <TableHead className="pl-6 w-[250px]">Employee & Status</TableHead>
                                            <TableHead className="text-right">Base Pay (₦)</TableHead>
                                            <TableHead className="text-right">Incentives (₦)</TableHead>
                                            <TableHead className="text-right">Loans/Deductions</TableHead>
                                            <TableHead className="text-right pr-6">Net Payable (₦)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {editablePay.map((p) => (
                                            <TableRow key={p.employeeId} className={cn(
                                                "hover:bg-muted/20 transition-colors",
                                                p.issues.length > 0 && "bg-red-50/30"
                                            )}>
                                                <TableCell className="pl-6 py-4">
                                                    <div className="font-bold text-sm">{p.name}</div>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {p.issues.length > 0 ? (
                                                            p.issues.map((issue, idx) => (
                                                                <Badge key={idx} variant="destructive" className="text-[8px] h-4 py-0 px-1 uppercase">{issue}</Badge>
                                                            ))
                                                        ) : (
                                                            <Badge variant="outline" className="text-[8px] h-4 py-0 px-1 uppercase bg-emerald-50 text-emerald-700">Validated</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-sm">₦{p.basePay.toLocaleString()}</TableCell>
                                                <TableCell className="text-right">
                                                    {currentStep === 'prepare' ? (
                                                        <Input 
                                                            type="number" 
                                                            className="h-8 w-28 ml-auto text-right font-mono text-xs border-primary/20 focus:ring-primary" 
                                                            value={p.jobIncentives} 
                                                            onChange={(e) => handleIncentiveChange(p.employeeId, e.target.value)}
                                                        />
                                                    ) : (
                                                        <span className="font-mono text-sm">₦{p.jobIncentives.toLocaleString()}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="text-red-600 font-mono font-bold text-sm">-₦{(p.loanDeduction + p.statutoryDeductions).toLocaleString()}</div>
                                                    <div className="text-[9px] text-muted-foreground uppercase">Inc. Statutory & Loans</div>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="font-bold font-headline text-lg text-primary">₦{p.netPay.toLocaleString()}</div>
                                                    <div className="text-[9px] text-muted-foreground">Gross: ₦{p.grossPay.toLocaleString()}</div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="bg-muted/30 border-t p-8 flex flex-col lg:flex-row justify-between items-center gap-8">
                            <div className="flex gap-12">
                                <SummaryItem label="Global Gross" value={`₦${totalGross.toLocaleString()}`} />
                                <SummaryItem label="Global Deductions" value={`₦${totalDeductions.toLocaleString()}`} color="text-red-600" />
                                <SummaryItem label="Net Cash Impact" value={`₦${totalNet.toLocaleString()}`} bold />
                            </div>
                            <div className="flex gap-3 w-full lg:w-auto">
                                <Button variant="ghost" onClick={() => setCurrentStep('dashboard')} className="rounded-xl px-6">Cancel Batch</Button>
                                {currentStep === 'prepare' ? (
                                    <Button onClick={handleSubmitForReview} className="h-14 px-10 rounded-2xl shadow-xl shadow-primary/20 text-lg font-bold">
                                        Freeze & Submit Audit <ArrowRight className="ml-2 h-5 w-5" />
                                    </Button>
                                ) : (
                                    <Button onClick={handleFinalDisburse} disabled={isLoading} className="h-14 px-10 rounded-2xl shadow-xl shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold">
                                        {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                                        Final Approve & Disburse
                                    </Button>
                                )}
                            </div>
                        </CardFooter>
                    </Card>
                </div>
            )}
        </div>
    );
}

function PayrollStatCard({ title, value, subtext, icon: Icon }: any) {
    return (
        <Card className="hover:shadow-md transition-shadow border-primary/5 shadow-lg shadow-primary/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
                <div className="bg-primary/10 p-2 rounded-lg"><Icon className="h-4 w-4 text-primary" /></div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold font-headline">{value}</div>
                <p className="text-[10px] text-muted-foreground mt-1">{subtext}</p>
            </CardContent>
        </Card>
    );
}

function SummaryItem({ label, value, color, bold }: { label: string, value: string, color?: string, bold?: boolean }) {
    return (
        <div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mb-1">{label}</p>
            <p className={cn("text-xl font-bold font-headline", color, bold && "text-primary")}>{value}</p>
        </div>
    );
}
