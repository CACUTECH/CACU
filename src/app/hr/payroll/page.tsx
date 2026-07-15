
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
    ArrowRight
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

interface EditableStaffPay {
    employeeId: string;
    name: string;
    basePay: number;
    jobIncentives: number;
    overtime: number;
    loanDeduction: number;
    statutoryDeductions: number; // Tax, Pension, etc.
    netPay: number;
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

        // Calculate active run defaults based on linked data (Jobs and Attendance logic)
        const initialPay = employees.map(emp => {
            const completedJobs = allJobs.filter(j => j.assignedStaffId === emp.id && j.status === 'Completed');
            const incentives = completedJobs.reduce((acc, curr) => acc + (curr.totalAmount * 0.1), 0);
            
            // Check for active loans
            const loan = initialLoans.find(l => l.employeeId === emp.id && l.status === 'Active');
            const loanDed = loan ? loan.monthlyDeduction : 0;
            
            // Simple statutory math for MVP (approx 15% combined tax/pension)
            const statDed = emp.baseSalary * 0.15;
            
            return {
                employeeId: emp.id,
                name: emp.name,
                basePay: emp.baseSalary,
                jobIncentives: incentives,
                overtime: 15000, // Simulated from attendance logs
                loanDeduction: loanDed,
                statutoryDeductions: statDed,
                netPay: emp.baseSalary + incentives + 15000 - loanDed - statDed
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
                title: "Run Prepared", 
                description: "Synced data from work orders, attendance sheets, and loan schedules." 
            });
        }, 1200);
    };

    const handleIncentiveChange = (id: string, newVal: string) => {
        const value = parseFloat(newVal) || 0;
        setEditablePay(prev => prev.map(p => {
            if (p.employeeId === id) {
                const newNet = p.basePay + value + p.overtime - p.loanDeduction - p.statutoryDeductions;
                return { ...p, jobIncentives: value, netPay: newNet };
            }
            return p;
        }));
    };

    const handleSubmitForReview = () => {
        setCurrentStep('review');
        toast({ 
            title: "Submitted for Approval", 
            description: "Payroll batch is now locked. Notification sent to Financial Controller for review." 
        });
    };

    const handleFinalDisburse = () => {
        setIsLoading(true);
        toast({ 
            title: "Disbursing Funds...", 
            description: "Updating General Ledger and generating electronic payment instructions." 
        });

        setTimeout(() => {
            const total = editablePay.reduce((acc, p) => acc + p.netPay, 0);
            const newRun: PayrollRun = {
                id: `run-${Date.now()}`,
                month: 'July 2024',
                totalPaid: total,
                employeesPaid: editablePay.length,
                status: 'Paid',
                preparedBy: 'Jane Doe',
                approvedBy: 'Financial Controller',
                payslips: editablePay.map(p => ({
                    employeeName: p.name,
                    netPay: p.netPay
                }))
            };
            setPayrollHistory(prev => [newRun, ...prev]);
            setIsLoading(false);
            setCurrentStep('dashboard');
            toast({
                title: "Payroll Finalized",
                description: `₦${total.toLocaleString()} disbursed to ${editablePay.length} employees.`,
            });
        }, 2000);
    };

    const handleQuickLinkAction = (label: string) => {
        toast({
            title: label,
            description: `Generating ${label} document for regulatory compliance...`
        });
    };

    const totalGross = editablePay.reduce((acc, p) => acc + p.basePay + p.jobIncentives + p.overtime, 0);
    const totalDeductions = editablePay.reduce((acc, p) => acc + p.loanDeduction + p.statutoryDeductions, 0);
    const totalNet = totalGross - totalDeductions;

    if (!mounted) return null;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight text-foreground">Staff Payroll Engine</h1>
                    <p className="text-muted-foreground mt-1">End-to-end automated processing with statutory compliance.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" asChild size="sm">
                        <Link href="/hr/payroll/config"><Settings className="mr-2 h-4 w-4" /> Global Config</Link>
                    </Button>
                    {currentStep === 'dashboard' && (
                        <Button onClick={handlePrepareRun} className="rounded-xl shadow-lg shadow-primary/20" disabled={isLoading}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
                            Prepare July Run
                        </Button>
                    )}
                </div>
            </div>

            {currentStep === 'dashboard' && (
                <div className="grid gap-6">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                        <PayrollStatCard title="YTD Payroll Cost" value="₦14.2M" subtext="Across all business units" icon={Wallet} />
                        <PayrollStatCard title="Avg. Employee Net" value="₦284k" subtext="+2% from last quarter" icon={TrendingUp} />
                        <PayrollStatCard title="Total Staff" value={employees.length.toString()} subtext="Active in database" icon={Users} />
                        <PayrollStatCard title="Compliance Health" value="100%" subtext="All remittances current" icon={ShieldCheck} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="font-headline">Disbursement History</CardTitle>
                                <CardDescription>Comprehensive audit trail of past payroll executions.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="pl-6">Month</TableHead>
                                            <TableHead className="text-center">Staff</TableHead>
                                            <TableHead className="text-right">Total (₦)</TableHead>
                                            <TableHead className="text-right pr-6">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payrollHistory.map(run => (
                                            <TableRow key={run.id} className="hover:bg-muted/10 transition-colors">
                                                <TableCell className="pl-6 font-bold">{run.month}</TableCell>
                                                <TableCell className="text-center">{run.employeesPaid}</TableCell>
                                                <TableCell className="text-right font-mono">₦{run.totalPaid.toLocaleString()}</TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">{run.status}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        <div className="space-y-6">
                            <Card className="bg-primary text-primary-foreground border-none shadow-xl shadow-primary/20">
                                <CardHeader>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Calculator className="h-5 w-5" />
                                        Next Run Estimate
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-3xl font-bold font-headline">₦{totalNet.toLocaleString()}</div>
                                    <p className="text-xs text-white/70 mt-2">Estimated based on current attendance logs, job completion incentives, and base salaries.</p>
                                </CardContent>
                                <CardFooter>
                                    <Button variant="secondary" className="w-full bg-white text-primary font-bold" onClick={handlePrepareRun}>Start Preparation</Button>
                                </CardFooter>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                                        <Briefcase className="h-4 w-4 text-primary" />
                                        Quick Links
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    <Button variant="outline" asChild className="w-full justify-start gap-2">
                                        <Link href="/hr/payroll/loans"><FileText className="h-4 w-4" /> Loans & Advances</Link>
                                    </Button>
                                    <Button variant="outline" className="w-full justify-start gap-2" onClick={() => handleQuickLinkAction("Tax Schedule (PAYE)")}>
                                        <FileSpreadsheet className="h-4 w-4" /> Tax Schedule (PAYE)
                                    </Button>
                                    <Button variant="outline" className="w-full justify-start gap-2" onClick={() => handleQuickLinkAction("Pension Remittance")}>
                                        <ShieldCheck className="h-4 w-4" /> Pension Remittance
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}

            {(currentStep === 'prepare' || currentStep === 'review') && (
                <Card className="border-primary/20 shadow-2xl shadow-primary/5 overflow-hidden">
                    <CardHeader className="bg-primary/5 border-b">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="font-headline text-xl">
                                    {currentStep === 'prepare' ? "Payroll Preparation" : "Payroll Audit & Review"}
                                </CardTitle>
                                <CardDescription>Data derived from {businessType} operations. Adjust incentives or bonuses before final review.</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Badge variant="outline" className={cn(
                                    "font-bold uppercase tracking-tighter",
                                    currentStep === 'prepare' ? "bg-amber-500/10 text-amber-700" : "bg-blue-500/10 text-blue-700"
                                )}>
                                    {currentStep === 'prepare' ? "MAKER STAGE" : "CHECKER STAGE"}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="pl-6">Employee</TableHead>
                                        <TableHead className="text-right">Base Pay (₦)</TableHead>
                                        <TableHead className="text-right">Incentives (₦)</TableHead>
                                        <TableHead className="text-right">Loan Repay (₦)</TableHead>
                                        <TableHead className="text-right">Statutory (₦)</TableHead>
                                        <TableHead className="text-right pr-6">Net Total (₦)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {editablePay.map((p) => (
                                        <TableRow key={p.employeeId} className="hover:bg-muted/20">
                                            <TableCell className="pl-6">
                                                <div className="font-bold text-sm">{p.name}</div>
                                                <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                                                    <Clock className="h-2 w-2" /> Synced Time logs
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono">₦{p.basePay.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">
                                                <Input 
                                                    type="number" 
                                                    className="h-8 w-24 ml-auto text-right font-mono" 
                                                    value={p.jobIncentives} 
                                                    onChange={(e) => handleIncentiveChange(p.employeeId, e.target.value)}
                                                    disabled={currentStep === 'review'}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right text-red-600 font-mono font-bold">
                                                -₦{p.loanDeduction.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right text-muted-foreground font-mono">
                                                -₦{p.statutoryDeductions.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right pr-6 font-bold font-headline text-lg text-primary">
                                                ₦{p.netPay.toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                    <CardFooter className="bg-muted/30 border-t p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex gap-8">
                            <SummaryItem label="Total Gross" value={`₦${totalGross.toLocaleString()}`} />
                            <SummaryItem label="Total Deductions" value={`₦${totalDeductions.toLocaleString()}`} color="text-red-600" />
                            <SummaryItem label="Net Disbursement" value={`₦${totalNet.toLocaleString()}`} bold />
                        </div>
                        <div className="flex gap-3 w-full md:w-auto">
                            <Button variant="ghost" onClick={() => setCurrentStep('dashboard')}>Discard Batch</Button>
                            {currentStep === 'prepare' ? (
                                <Button onClick={handleSubmitForReview} className="h-12 px-8 rounded-xl shadow-lg">
                                    Submit for Review <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            ) : (
                                <Button onClick={handleFinalDisburse} disabled={isLoading} className="h-12 px-8 rounded-xl shadow-lg bg-emerald-600 hover:bg-emerald-700 text-white">
                                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                                    Approve & Disburse July Run
                                </Button>
                            )}
                        </div>
                    </CardFooter>
                </Card>
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
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{label}</p>
            <p className={cn("text-lg font-bold font-headline", color, bold && "text-primary")}>{value}</p>
        </div>
    );
}
