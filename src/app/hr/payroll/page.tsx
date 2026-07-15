
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
    PlusCircle
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
import { cn } from "@/lib/utils";
import { employees, jobs as allJobs, payrollHistory as initialPayrollHistory } from "@/lib/data";
import type { PayrollRun, BusinessType } from "@/lib/data";

interface EditableStaffPay {
    employeeId: string;
    name: string;
    basePay: number;
    jobIncentives: number;
    overtime: number;
    deductions: number;
    netPay: number;
}

export default function PayrollPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(false);
    const [businessType, setBusinessType] = React.useState<BusinessType>('HYBRID');
    const [payrollHistory, setPayrollHistory] = React.useState(initialPayrollHistory);
    const [isReviewMode, setIsReviewMode] = React.useState(false);
    const [editablePay, setEditablePay] = React.useState<EditableStaffPay[]>([]);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        const savedType = localStorage.getItem('business-type') as BusinessType;
        if (savedType) setBusinessType(savedType);

        // Initialize editable payroll from staff and job data
        const initialPay = employees.map(emp => {
            const completedJobs = allJobs.filter(j => j.assignedStaffId === emp.id && j.status === 'Completed');
            // Simulate incentive: 10% of job value for Service/Hybrid
            const incentives = completedJobs.reduce((acc, curr) => acc + (curr.totalAmount * 0.1), 0);
            const base = 250000; // Sample base
            return {
                employeeId: emp.id,
                name: emp.name,
                basePay: base,
                jobIncentives: incentives,
                overtime: 15000, // Sample fixed for demo
                deductions: 35000, // Sample fixed for demo
                netPay: base + incentives + 15000 - 35000
            };
        });
        setEditablePay(initialPay);
    }, []);

    const handleUpdatePay = (id: string, field: keyof EditableStaffPay, value: string) => {
        const num = parseFloat(value) || 0;
        setEditablePay(prev => prev.map(p => {
            if (p.employeeId === id) {
                const updated = { ...p, [field]: num };
                updated.netPay = updated.basePay + updated.jobIncentives + updated.overtime - updated.deductions;
                return updated;
            }
            return p;
        }));
    };

    const handleRunPayroll = () => {
        setIsLoading(true);
        toast({
            title: "Disbursing Funds...",
            description: "Calculating ledger entries and generating bank files.",
        });

        setTimeout(() => {
            const total = editablePay.reduce((acc, p) => acc + p.netPay, 0);
            const newRun: PayrollRun = {
                id: `run-${Date.now()}`,
                month: 'July 2024',
                totalPaid: total,
                employeesPaid: editablePay.length,
                payslips: editablePay.map(p => ({
                    employeeName: p.name,
                    netPay: p.netPay
                }))
            };
            setPayrollHistory(prev => [newRun, ...prev]);
            setIsLoading(false);
            setIsReviewMode(false);
            toast({
                title: "Payroll Executed Successfully",
                description: "₦" + total.toLocaleString() + " processed for " + editablePay.length + " staff.",
            });
        }, 2000);
    };

    const totalGross = editablePay.reduce((acc, p) => acc + p.basePay + p.jobIncentives + p.overtime, 0);
    const totalDeductions = editablePay.reduce((acc, p) => acc + p.deductions, 0);
    const totalNet = totalGross - totalDeductions;

    if (!mounted) return null;

    return (
        <div className="flex flex-col gap-8 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Payroll Management</h1>
                    <p className="text-muted-foreground mt-1">
                        Automated compensation linked to {businessType === 'SERVICE' ? 'jobs and hours' : businessType === 'PRODUCT' ? 'sales and time' : 'all operational metrics'}.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {!isReviewMode ? (
                        <Button onClick={() => setIsReviewMode(true)} className="rounded-xl shadow-lg shadow-primary/20">
                            <Calculator className="mr-2 h-4 w-4" />
                            Prepare July Run
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => setIsReviewMode(false)}>
                            Cancel Preparation
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Projected Gross</CardTitle>
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₦{totalGross.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Total Deductions</CardTitle>
                        <TrendingUp className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₦{totalDeductions.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-primary">Net Disbursement</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">₦{totalNet.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-xs font-bold uppercase text-muted-foreground">Staff Count</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{employees.length} Active</div>
                    </CardContent>
                </Card>
            </div>

            {isReviewMode ? (
                <Card className="border-primary/20 shadow-xl shadow-primary/5">
                    <CardHeader className="bg-primary/5 border-b">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="font-headline">Review & Adjust Payroll</CardTitle>
                                <CardDescription>Data synced from Attendance and completed Work Orders.</CardDescription>
                            </div>
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20 font-bold">
                                PRE-RUN DRAFT
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="pl-6">Employee</TableHead>
                                    <TableHead className="text-right">Base Salary (₦)</TableHead>
                                    <TableHead className="text-right">Job Bonus (₦)</TableHead>
                                    <TableHead className="text-right">OT/Incentive (₦)</TableHead>
                                    <TableHead className="text-right">Deductions (₦)</TableHead>
                                    <TableHead className="text-right pr-6">Net Total (₦)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {editablePay.map((p) => (
                                    <TableRow key={p.employeeId} className="hover:bg-muted/30 transition-colors group">
                                        <TableCell className="pl-6">
                                            <div className="font-bold text-sm">{p.name}</div>
                                            <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                                                <Briefcase className="h-2 w-2" /> Tracked Output
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-mono" 
                                                value={p.basePay} 
                                                onChange={(e) => handleUpdatePay(p.employeeId, 'basePay', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-mono bg-emerald-50/30" 
                                                value={p.jobIncentives} 
                                                onChange={(e) => handleUpdatePay(p.employeeId, 'jobIncentives', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-mono" 
                                                value={p.overtime} 
                                                onChange={(e) => handleUpdatePay(p.employeeId, 'overtime', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                className="h-8 text-right font-mono text-red-600" 
                                                value={p.deductions} 
                                                onChange={(e) => handleUpdatePay(p.employeeId, 'deductions', e.target.value)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-right pr-6 font-bold font-headline text-lg">
                                            ₦{p.netPay.toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                    <CardFooter className="bg-muted/30 border-t p-6 flex justify-between items-center">
                        <p className="text-xs text-muted-foreground max-w-md italic">
                            * Job bonuses are calculated based on 10% commission for completed service orders. Deductions include PAYE and Pension contributions.
                        </p>
                        <div className="flex gap-3">
                            <Button variant="outline" onClick={() => setIsReviewMode(false)}>Discard</Button>
                            <Button onClick={handleRunPayroll} disabled={isLoading} className="h-12 px-8 rounded-xl shadow-lg">
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Approve & Disburse
                            </Button>
                        </div>
                    </CardFooter>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="font-headline">Disbursement History</CardTitle>
                        <CardDescription>Past payroll runs and individual payslip logs.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="pl-6">Reporting Month</TableHead>
                                        <TableHead className="text-center">Team Members</TableHead>
                                        <TableHead className="text-right">Total Disbursed</TableHead>
                                        <TableHead className="text-right pr-6">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {payrollHistory.map(run => (
                                        <TableRow key={run.id} className="hover:bg-muted/10 transition-colors">
                                            <TableCell className="pl-6 font-medium">{run.month}</TableCell>
                                            <TableCell className="text-center">{run.employeesPaid} Paid</TableCell>
                                            <TableCell className="text-right font-mono font-bold">₦{run.totalPaid.toLocaleString()}</TableCell>
                                            <TableCell className="text-right pr-6">
                                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 uppercase text-[10px] font-bold">
                                                    Finalized
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-primary/5 border-dashed border-2">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Clock className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">Attendance Link</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="text-sm space-y-4">
                        <p className="text-muted-foreground">
                            Payroll data is automatically matched with the workforce tracking module. Any "Late" check-ins or "Short Shifts" are flagged for manual deduction review.
                        </p>
                        <Button variant="link" className="p-0 text-primary h-auto text-xs font-bold">View Timesheet Reconciliation →</Button>
                    </CardContent>
                </Card>
                <Card className="flex flex-col justify-center p-6 text-center md:text-left gap-4">
                    <div className="space-y-1">
                        <h3 className="font-headline text-xl font-bold">Regulatory Compliance</h3>
                        <p className="text-sm text-muted-foreground">Automatically calculate and export FRCN-compliant tax schedules for your monthly state revenue filings.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                        <Button variant="outline" size="sm" className="gap-2 rounded-xl">
                            <FileDown className="h-4 w-4" /> Download Tax Schedule
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2 rounded-xl">
                            <PlusCircle className="h-4 w-4" /> Setup Benefit Scheme
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
