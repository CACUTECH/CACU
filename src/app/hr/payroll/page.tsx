
"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { payrollHistory as initialPayrollHistory } from "@/lib/data";
import type { PayrollRun } from "@/lib/data";

function RunPayrollDialog({ onConfirm }: { onConfirm: () => void }) {
    const [isOpen, setIsOpen] = React.useState(false);

    const handleConfirm = () => {
        onConfirm();
        setIsOpen(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <FileDown className="mr-2 h-4 w-4" />
                    Run Payroll
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm Payroll Run</DialogTitle>
                    <DialogDescription>
                        You are about to run payroll for July 2024. Please review the details below before confirming.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total Gross Pay</span>
                        <span className="font-bold font-headline">₦1,550,000</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Total Deductions</span>
                        <span className="font-bold font-headline">₦232,500</span>
                    </div>
                     <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">Total Net Pay</span>
                        <span className="font-bold font-headline">₦1,317,500</span>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleConfirm}>
                        Confirm & Run Payroll
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PayrollDetailsDialog({ run, open, onOpenChange }: { run: PayrollRun | null, open: boolean, onOpenChange: (open: boolean) => void }) {
    if (!run) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Payroll Details - {run.month}</DialogTitle>
                     <DialogDescription>
                        Details of all employees paid during this payroll run.
                    </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Employee</TableHead>
                                <TableHead className="text-right">Net Pay</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {run.payslips.map(p => (
                                <TableRow key={p.employeeName}>
                                    <TableCell>{p.employeeName}</TableCell>
                                    <TableCell className="text-right font-mono">₦{p.netPay.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                             <TableRow className="font-bold bg-muted/50">
                                <TableCell>Total Paid</TableCell>
                                <TableCell className="text-right font-mono">₦{run.totalPaid.toLocaleString()}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
                 <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function PayrollPage() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(false);
    const [payrollHistory, setPayrollHistory] = React.useState(initialPayrollHistory);
    const [selectedRun, setSelectedRun] = React.useState<PayrollRun | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);

    const handleRunPayroll = () => {
        setIsLoading(true);
        toast({
            title: "Processing Payroll...",
            description: "This may take a few moments.",
        });

        setTimeout(() => {
            setIsLoading(false);
            const newRun: PayrollRun = {
                id: `run-${Date.now()}`,
                month: 'July 2024',
                totalPaid: 1317500,
                employeesPaid: 4,
                payslips: [
                    { employeeName: "Grace Adebayo", netPay: 425000 },
                    { employeeName: "Samuel Okoro", netPay: 340000 },
                    { employeeName: "Chioma Nwosu", netPay: 297500 },
                    { employeeName: "David Bello", netPay: 255000 },
                ]
            };
            setPayrollHistory(prev => [newRun, ...prev]);
            toast({
                title: "Payroll Complete!",
                description: "July 2024 payroll has been processed successfully.",
            });
        }, 2000);
    }
    
    const handleViewDetails = (run: PayrollRun) => {
        setSelectedRun(run);
        setIsDetailsOpen(true);
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold">Payroll</h1>
                    <p className="text-muted-foreground">
                        Manage and process your company's payroll.
                    </p>
                </div>
                <RunPayrollDialog onConfirm={handleRunPayroll} />
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Payroll Summary - July 2024</CardTitle>
                    <CardDescription>
                        Summary of the current payroll period.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Gross Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,550,000</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Deductions</h3>
                            <p className="text-2xl font-bold font-headline">₦232,500</p>
                         </div>
                         <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                            <h3 className="text-sm font-medium text-muted-foreground">Total Net Pay</h3>
                            <p className="text-2xl font-bold font-headline">₦1,317,500</p>
                         </div>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Payroll History</CardTitle>
                </CardHeader>
                <CardContent>
                     {isLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Processing payroll...</span>
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Month</TableHead>
                                        <TableHead>Employees Paid</TableHead>
                                        <TableHead className="text-right">Total Amount</TableHead>
                                        <TableHead><span className="sr-only">Actions</span></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {payrollHistory.map(run => (
                                        <TableRow key={run.id}>
                                            <TableCell className="font-medium">{run.month}</TableCell>
                                            <TableCell>{run.employeesPaid}</TableCell>
                                            <TableCell className="text-right font-mono">₦{run.totalPaid.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => handleViewDetails(run)}>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    View Details
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
            <PayrollDetailsDialog run={selectedRun} open={isDetailsOpen} onOpenChange={setIsDetailsOpen} />
        </div>
    );
}
